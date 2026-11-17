//! The SQL statement a tool call carries, read with a parser so the voice can
//! say what a plain read looks up. A statement is described only when it is
//! certainly one plain read: every part of it is on the allow-list below,
//! under every dialect tried. Anything else gets no description.

use super::change::is_sql_statement;
use crate::models::message::ToolCallReadOperator;
use sqlparser::ast::{
    BinaryOperator, Distinct, Expr, Function, FunctionArg, FunctionArgExpr, FunctionArguments,
    GroupByExpr, Join, JoinConstraint, JoinOperator, LimitClause, ObjectName, ObjectNamePart,
    OrderByKind, Query, Select, SelectFlavor, SelectItem, SetExpr, Statement, TableFactor,
    TableWithJoins, TopQuantity, UnaryOperator, Value, WildcardAdditionalOptions, WindowType,
};
use sqlparser::dialect::{
    Dialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer};
use std::collections::HashSet;

/// Longer statements are not parsed.
const MAX_SQL_BYTES: usize = 16 * 1024;
/// How deep the parser nests; the walks below recurse no deeper.
const MAX_DEPTH: usize = 32;
pub(super) const MAX_TABLES: usize = 4;
pub(super) const MAX_CONDITIONS: usize = 6;
pub(super) const MAX_CONDITION_VALUES: usize = 5;

static MSSQL: MsSqlDialect = MsSqlDialect {};
static POSTGRES: PostgreSqlDialect = PostgreSqlDialect {};
static MYSQL: MySqlDialect = MySqlDialect {};
static SQLITE: SQLiteDialect = SQLiteDialect {};
static GENERIC: GenericDialect = GenericDialect {};

/// Parsed in this order; T-SQL first, as SQL endpoints of Dataverse and SQL
/// Server take it.
fn dialects() -> [&'static dyn Dialect; 5] {
    [&MSSQL, &POSTGRES, &MYSQL, &SQLITE, &GENERIC]
}

/// Unquoted words that start a statement where T-SQL needs no `;` between
/// two, or turn a SELECT into a write (`INTO`, `FOR UPDATE`). One of them
/// anywhere outside a string, a quoted name or a comment, under any
/// dialect's reading, means no description.
const NOT_A_READ_WORDS: [&str; 56] = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "UPSERT",
    "INTO",
    "OUTFILE",
    "DUMPFILE",
    "EXEC",
    "EXECUTE",
    "CALL",
    "DO",
    "DECLARE",
    "SET",
    "IF",
    "WHILE",
    "BEGIN",
    "GOTO",
    "RETURN",
    "BREAK",
    "CONTINUE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "RENAME",
    "GRANT",
    "DENY",
    "REVOKE",
    "USE",
    "PRINT",
    "RAISERROR",
    "THROW",
    "WAITFOR",
    "BACKUP",
    "RESTORE",
    "DBCC",
    "KILL",
    "SHUTDOWN",
    "BULK",
    "OPEN",
    "CLOSE",
    "DEALLOCATE",
    "COMMIT",
    "ROLLBACK",
    "SAVE",
    "RECONFIGURE",
    "CHECKPOINT",
    "WRITETEXT",
    "UPDATETEXT",
    "SETUSER",
    "REVERT",
    "SEND",
    "RECEIVE",
    "LOCK",
    "COPY",
];

/// Table hints that take no update or exclusive lock.
const READ_HINTS: [&str; 6] = [
    "NOLOCK",
    "READUNCOMMITTED",
    "READCOMMITTED",
    "READPAST",
    "NOWAIT",
    "NOEXPAND",
];

/// Functions that only compute a value from their arguments. Any other
/// function may write (a user function, `nextval`, `pg_terminate_backend`),
/// so a statement calling one gets no description.
const PURE_FUNCTIONS: [&str; 74] = [
    "count",
    "count_big",
    "sum",
    "avg",
    "min",
    "max",
    "stdev",
    "var",
    "string_agg",
    "lower",
    "upper",
    "trim",
    "ltrim",
    "rtrim",
    "len",
    "length",
    "char_length",
    "substring",
    "substr",
    "left",
    "right",
    "concat",
    "concat_ws",
    "coalesce",
    "isnull",
    "nullif",
    "ifnull",
    "iif",
    "round",
    "abs",
    "floor",
    "ceiling",
    "ceil",
    "sign",
    "power",
    "sqrt",
    "year",
    "month",
    "day",
    "datepart",
    "datename",
    "dateadd",
    "datediff",
    "eomonth",
    "getdate",
    "getutcdate",
    "sysdatetime",
    "sysutcdatetime",
    "current_timestamp",
    "current_date",
    "now",
    "date_trunc",
    "to_char",
    "format",
    "replace",
    "charindex",
    "patindex",
    "reverse",
    "replicate",
    "try_cast",
    "try_convert",
    "row_number",
    "rank",
    "dense_rank",
    "ntile",
    "lag",
    "lead",
    "first_value",
    "last_value",
    "date",
    "datetime",
    "strftime",
    "cast",
    "convert",
];

/// What a plain read says about itself, before values are cleaned.
#[derive(Debug, Default, PartialEq)]
pub(super) struct PlainRead {
    /// Each table once, as the statement names it (its last name part).
    pub tables: Vec<String>,
    pub tables_omitted: u32,
    pub conditions: Vec<PlainCondition>,
    /// Conditions past the cap or too complex to say, counted.
    pub undescribed: u32,
    pub limit: Option<u64>,
}

#[derive(Debug, PartialEq)]
pub(super) struct PlainCondition {
    pub column: String,
    /// The table the column belongs to, when the statement reads several and
    /// the column names its table or alias.
    pub table: Option<String>,
    pub operator: ToolCallReadOperator,
    pub values: Vec<String>,
    pub values_omitted: u32,
}

/// Whether `text` has the shape of an SQL statement, also behind leading
/// comments, which [`is_sql_statement`] does not look past: `/* x */ DELETE
/// FROM t` is never a search text.
pub(super) fn may_be_sql(text: &str) -> bool {
    is_sql_statement(text) || is_sql_statement(after_leading_comments(text))
}

fn after_leading_comments(text: &str) -> &str {
    let mut rest = text;
    loop {
        let trimmed = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '(');
        if let Some(after) = trimmed
            .strip_prefix("--")
            .or_else(|| trimmed.strip_prefix('#'))
        {
            rest = after.split_once('\n').map_or("", |(_, next)| next);
        } else if let Some(after) = trimmed.strip_prefix("/*") {
            rest = after.split_once("*/").map_or("", |(_, next)| next);
        } else {
            return trimmed;
        }
    }
}

/// The description of `text` when it is certainly one plain read: one
/// SELECT, alone, that only reads tables and calls only functions on the
/// pure list. `None` for anything else, including what no dialect parses.
pub(super) fn plain_read(text: &str) -> Option<PlainRead> {
    // Whether a `--` comment ends at a Unicode line separator differs
    // between servers, so a statement holding one is not certain.
    if text.trim().is_empty()
        || text.len() > MAX_SQL_BYTES
        || text.contains(['\u{2028}', '\u{2029}', '\u{85}'])
        || !only_read_words(text)
    {
        return None;
    }
    let statement = dialects().into_iter().find_map(|dialect| {
        let mut statements = Parser::new(dialect)
            .with_recursion_limit(MAX_DEPTH)
            .try_with_sql(text)
            .ok()?
            .parse_statements()
            .ok()?;
        (statements.len() == 1).then(|| statements.remove(0))
    })?;
    let Statement::Query(query) = statement else {
        return None;
    };
    query_reads(&query).then(|| describe(&query))
}

/// The tokens of every dialect hold no word of [`NOT_A_READ_WORDS`] and
/// nothing after a `;`. Each dialect has its own comments and quotes, so a
/// write one of them hides is still found by another.
fn only_read_words(text: &str) -> bool {
    dialects().into_iter().all(|dialect| {
        let Ok(tokens) = Tokenizer::new(dialect, text).tokenize() else {
            return false;
        };
        let mut ended = false;
        tokens.iter().all(|token| match token {
            Token::Whitespace(_) | Token::EOF => true,
            _ if ended => false,
            Token::SemiColon => {
                ended = true;
                true
            }
            Token::Word(word) if word.quote_style.is_none() => !NOT_A_READ_WORDS
                .iter()
                .any(|denied| word.value.eq_ignore_ascii_case(denied)),
            _ => true,
        })
    })
}

// ---------------------------------------------------------------------------
// The allow-list. Every struct is taken apart field by field, so a parser
// version with a new clause fails to build here instead of letting it pass.

fn query_reads(query: &Query) -> bool {
    let Query {
        with,
        body,
        order_by,
        limit_clause,
        fetch,
        locks,
        for_clause,
        settings,
        format_clause,
        pipe_operators,
    } = query;
    let ctes_read = with.as_ref().is_none_or(|with| {
        with.cte_tables
            .iter()
            .all(|cte| cte.from.is_none() && query_reads(&cte.query))
    });
    let order_reads = order_by.as_ref().is_none_or(|order_by| {
        order_by.interpolate.is_none()
            && match &order_by.kind {
                OrderByKind::Expressions(exprs) => exprs
                    .iter()
                    .all(|expr| expr.with_fill.is_none() && expr_reads(&expr.expr)),
                OrderByKind::All(_) => false,
            }
    });
    let limit_reads = limit_clause.as_ref().is_none_or(|limit| match limit {
        LimitClause::LimitOffset {
            limit,
            offset,
            limit_by,
        } => {
            limit.as_ref().is_none_or(expr_reads)
                && offset
                    .as_ref()
                    .is_none_or(|offset| expr_reads(&offset.value))
                && limit_by.is_empty()
        }
        LimitClause::OffsetCommaLimit { offset, limit } => expr_reads(offset) && expr_reads(limit),
    });
    ctes_read
        && set_reads(body)
        && order_reads
        && limit_reads
        && fetch
            .as_ref()
            .is_none_or(|fetch| fetch.quantity.as_ref().is_none_or(expr_reads))
        && locks.is_empty()
        && for_clause.is_none()
        && settings.is_none()
        && format_clause.is_none()
        && pipe_operators.is_empty()
}

fn set_reads(body: &SetExpr) -> bool {
    match body {
        SetExpr::Select(select) => select_reads(select),
        SetExpr::Query(query) => query_reads(query),
        SetExpr::SetOperation { left, right, .. } => set_reads(left) && set_reads(right),
        SetExpr::Values(_)
        | SetExpr::Insert(_)
        | SetExpr::Update(_)
        | SetExpr::Delete(_)
        | SetExpr::Merge(_)
        | SetExpr::Table(_) => false,
    }
}

fn select_reads(select: &Select) -> bool {
    let Select {
        select_token: _,
        optimizer_hints,
        distinct,
        select_modifiers,
        top,
        top_before_distinct: _,
        projection,
        exclude,
        into,
        from,
        lateral_views,
        prewhere,
        selection,
        connect_by,
        group_by,
        cluster_by,
        distribute_by,
        sort_by,
        having,
        named_window,
        qualify,
        window_before_qualify: _,
        value_table_mode,
        flavor,
    } = select;
    let distinct_reads = match distinct {
        None | Some(Distinct::All | Distinct::Distinct) => true,
        Some(Distinct::On(exprs)) => exprs.iter().all(expr_reads),
    };
    let top_reads = top.as_ref().is_none_or(|top| match &top.quantity {
        Some(TopQuantity::Expr(expr)) => expr_reads(expr),
        Some(TopQuantity::Constant(_)) | None => true,
    });
    let group_reads = match group_by {
        GroupByExpr::Expressions(exprs, modifiers) => {
            modifiers.is_empty() && exprs.iter().all(expr_reads)
        }
        GroupByExpr::All(_) => false,
    };
    optimizer_hints.is_empty()
        && distinct_reads
        && select_modifiers.is_none()
        && top_reads
        && projection.iter().all(item_reads)
        && exclude.is_none()
        && into.is_none()
        && from.iter().all(tables_read)
        && lateral_views.is_empty()
        && prewhere.is_none()
        && selection.as_ref().is_none_or(expr_reads)
        && connect_by.is_empty()
        && group_reads
        && cluster_by.is_empty()
        && distribute_by.is_empty()
        && sort_by.is_empty()
        && having.as_ref().is_none_or(expr_reads)
        && named_window.is_empty()
        && qualify.is_none()
        && value_table_mode.is_none()
        && *flavor == SelectFlavor::Standard
}

fn item_reads(item: &SelectItem) -> bool {
    match item {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => expr_reads(expr),
        SelectItem::ExprWithAliases { .. } => false,
        SelectItem::QualifiedWildcard(_, options) | SelectItem::Wildcard(options) => {
            plain_wildcard(options)
        }
    }
}

fn plain_wildcard(options: &WildcardAdditionalOptions) -> bool {
    let WildcardAdditionalOptions {
        wildcard_token: _,
        opt_ilike,
        opt_exclude,
        opt_except,
        opt_replace,
        opt_rename,
        opt_alias,
    } = options;
    opt_ilike.is_none()
        && opt_exclude.is_none()
        && opt_except.is_none()
        && opt_replace.is_none()
        && opt_rename.is_none()
        && opt_alias.is_none()
}

fn tables_read(tables: &TableWithJoins) -> bool {
    table_reads(&tables.relation) && tables.joins.iter().all(join_reads)
}

fn table_reads(table: &TableFactor) -> bool {
    match table {
        TableFactor::Table {
            name,
            alias: _,
            args,
            with_hints,
            version,
            with_ordinality,
            partitions,
            json_path,
            sample,
            index_directives,
            inheritance,
        } => {
            plain_name(name)
                && args.is_none()
                // `WITH (NOLOCK)` reads; `XLOCK`, `UPDLOCK` or `TABLOCKX`
                // lock as `FOR UPDATE` does.
                && with_hints.iter().all(|hint| {
                    matches!(hint, Expr::Identifier(ident) if READ_HINTS
                        .iter()
                        .any(|read| ident.value.eq_ignore_ascii_case(read)))
                })
                && version.is_none()
                && !with_ordinality
                && partitions.is_empty()
                && json_path.is_none()
                && sample.is_none()
                && index_directives.is_empty()
                && inheritance.is_none()
        }
        TableFactor::Derived {
            lateral,
            subquery,
            alias: _,
            sample,
        } => !lateral && sample.is_none() && query_reads(subquery),
        TableFactor::NestedJoin {
            table_with_joins,
            alias: _,
        } => tables_read(table_with_joins),
        _ => false,
    }
}

fn join_reads(join: &Join) -> bool {
    let constraint = match &join.join_operator {
        JoinOperator::Join(constraint)
        | JoinOperator::Inner(constraint)
        | JoinOperator::Left(constraint)
        | JoinOperator::LeftOuter(constraint)
        | JoinOperator::Right(constraint)
        | JoinOperator::RightOuter(constraint)
        | JoinOperator::FullOuter(constraint)
        | JoinOperator::CrossJoin(constraint) => constraint,
        _ => return false,
    };
    let constraint_reads = match constraint {
        JoinConstraint::On(expr) => expr_reads(expr),
        JoinConstraint::Using(_) | JoinConstraint::Natural | JoinConstraint::None => true,
        JoinConstraint::UsingAlias(..) => false,
    };
    !join.global && constraint_reads && table_reads(&join.relation)
}

fn plain_name(name: &ObjectName) -> bool {
    !name.0.is_empty()
        && name
            .0
            .iter()
            .all(|part| matches!(part, ObjectNamePart::Identifier(_)))
}

fn expr_reads(expr: &Expr) -> bool {
    match expr {
        Expr::Identifier(_) | Expr::CompoundIdentifier(_) | Expr::Value(_) => true,
        Expr::IsFalse(inner)
        | Expr::IsNotFalse(inner)
        | Expr::IsTrue(inner)
        | Expr::IsNotTrue(inner)
        | Expr::IsNull(inner)
        | Expr::IsNotNull(inner)
        | Expr::IsUnknown(inner)
        | Expr::IsNotUnknown(inner)
        | Expr::Nested(inner)
        | Expr::UnaryOp { expr: inner, .. }
        | Expr::Cast { expr: inner, .. }
        | Expr::Ceil { expr: inner, .. }
        | Expr::Floor { expr: inner, .. }
        | Expr::Collate { expr: inner, .. } => expr_reads(inner),
        Expr::IsDistinctFrom(left, right) | Expr::IsNotDistinctFrom(left, right) => {
            expr_reads(left) && expr_reads(right)
        }
        Expr::BinaryOp { left, right, .. } => expr_reads(left) && expr_reads(right),
        Expr::In { expr, target, .. } => {
            expr_reads(expr)
                && match target {
                    sqlparser::ast::InTarget::List(list) => list.iter().all(expr_reads),
                    sqlparser::ast::InTarget::Subquery(query) => query_reads(query),
                    _ => false,
                }
        }
        Expr::Between {
            expr, low, high, ..
        } => expr_reads(expr) && expr_reads(low) && expr_reads(high),
        Expr::Like {
            expr,
            pattern,
            escape_char,
            ..
        }
        | Expr::ILike {
            expr,
            pattern,
            escape_char,
            ..
        } => {
            expr_reads(expr) && expr_reads(pattern) && escape_char.as_deref().is_none_or(expr_reads)
        }
        Expr::Convert { expr, styles, .. } => expr_reads(expr) && styles.iter().all(expr_reads),
        Expr::Substring {
            expr,
            substring_from,
            substring_for,
            ..
        } => {
            expr_reads(expr)
                && substring_from.as_deref().is_none_or(expr_reads)
                && substring_for.as_deref().is_none_or(expr_reads)
        }
        Expr::Trim {
            expr,
            trim_what,
            trim_characters,
            ..
        } => {
            expr_reads(expr)
                && trim_what.as_deref().is_none_or(expr_reads)
                && trim_characters
                    .as_ref()
                    .is_none_or(|characters| characters.iter().all(expr_reads))
        }
        Expr::Function(function) => function_reads(function),
        Expr::Case {
            operand,
            conditions,
            else_result,
            ..
        } => {
            operand.as_deref().is_none_or(expr_reads)
                && conditions
                    .iter()
                    .all(|when| expr_reads(&when.condition) && expr_reads(&when.result))
                && else_result.as_deref().is_none_or(expr_reads)
        }
        Expr::Exists { subquery, .. } | Expr::Subquery(subquery) => query_reads(subquery),
        Expr::Tuple(exprs) => exprs.iter().all(expr_reads),
        _ => false,
    }
}

fn function_reads(function: &Function) -> bool {
    let Function {
        name,
        uses_odbc_syntax: _,
        parameters,
        args,
        within_group,
        filter,
        null_treatment: _,
        over,
    } = function;
    let pure = match name.0.as_slice() {
        [ObjectNamePart::Identifier(ident)] => PURE_FUNCTIONS
            .iter()
            .any(|pure| ident.value.eq_ignore_ascii_case(pure)),
        _ => false,
    };
    let over_reads = match over {
        None => true,
        Some(WindowType::WindowSpec(spec)) => {
            spec.window_name.is_none()
                && spec.window_frame.is_none()
                && spec.partition_by.iter().all(expr_reads)
                && spec.order_by.iter().all(|expr| expr_reads(&expr.expr))
        }
        Some(WindowType::NamedWindow(_)) => false,
    };
    pure && matches!(parameters, FunctionArguments::None)
        && arguments_read(args)
        && within_group.iter().all(|expr| expr_reads(&expr.expr))
        && filter.as_deref().is_none_or(expr_reads)
        && over_reads
}

fn arguments_read(arguments: &FunctionArguments) -> bool {
    match arguments {
        FunctionArguments::None => true,
        FunctionArguments::Subquery(query) => query_reads(query),
        FunctionArguments::List(list) => {
            list.clauses.is_empty()
                && list.args.iter().all(|argument| {
                    let argument = match argument {
                        FunctionArg::Unnamed(argument)
                        | FunctionArg::Named { arg: argument, .. } => argument,
                        FunctionArg::ExprNamed { .. } => return false,
                    };
                    match argument {
                        FunctionArgExpr::Expr(expr) => expr_reads(expr),
                        FunctionArgExpr::Wildcard | FunctionArgExpr::QualifiedWildcard(_) => true,
                        FunctionArgExpr::WildcardWithOptions(options) => plain_wildcard(options),
                    }
                })
        }
    }
}

// ---------------------------------------------------------------------------
// What a statement that passed the allow-list says.

/// A CTE by its name, with what it reads.
type Ctes<'a> = Vec<(&'a str, &'a Query)>;

/// Steps the description takes at most; the rest of a statement counts as
/// one condition not said. The allow-list above is linear, but a CTE named
/// in several places would otherwise be read again at every place.
const MAX_DESCRIBE_STEPS: usize = 2_000;

/// What reading a statement for its description shares.
#[derive(Default)]
struct Walk {
    read: PlainRead,
    /// CTEs read already, by address: each is read once per statement.
    expanded: HashSet<usize>,
    steps: usize,
    cut: bool,
    /// Table aliases of the outermost SELECT, lower case, with their tables.
    aliases: Vec<(String, String)>,
}

impl Walk {
    /// Whether the budget allows one more step.
    fn step(&mut self) -> bool {
        self.steps += 1;
        if self.steps > MAX_DESCRIBE_STEPS {
            self.cut = true;
        }
        !self.cut
    }
}

fn describe(query: &Query) -> PlainRead {
    let mut walk = Walk::default();
    walk.read.limit = limit_of(query);
    let ctes = ctes_of(query);
    match query.body.as_ref() {
        SetExpr::Select(select) => {
            if walk.read.limit.is_none() {
                walk.read.limit = top_of(select);
            }
            select_tables(select, &ctes, &mut walk, 0, true);
            if let Some(selection) = &select.selection {
                add_conditions(selection, &mut walk);
            }
            if select.having.is_some() {
                walk.read.undescribed += 1;
            }
        }
        other => set_tables(other, &ctes, &mut walk, 0),
    }
    if walk.cut {
        walk.read.undescribed += 1;
    }
    walk.read
}

fn ctes_of(query: &Query) -> Ctes<'_> {
    query
        .with
        .iter()
        .flat_map(|with| &with.cte_tables)
        .map(|cte| (cte.alias.name.value.as_str(), cte.query.as_ref()))
        .collect()
}

fn limit_of(query: &Query) -> Option<u64> {
    let limit = match &query.limit_clause {
        Some(LimitClause::LimitOffset {
            limit: Some(limit), ..
        })
        | Some(LimitClause::OffsetCommaLimit { limit, .. }) => Some(limit),
        _ => None,
    };
    limit
        .or_else(|| {
            query
                .fetch
                .as_ref()
                .filter(|fetch| !fetch.percent)?
                .quantity
                .as_ref()
        })
        .and_then(whole_number)
}

fn top_of(select: &Select) -> Option<u64> {
    let top = select.top.as_ref().filter(|top| !top.percent)?;
    match top.quantity.as_ref()? {
        TopQuantity::Constant(count) => Some(*count),
        TopQuantity::Expr(expr) => whole_number(expr),
    }
}

fn whole_number(expr: &Expr) -> Option<u64> {
    match expr {
        Expr::Value(value) => match &value.value {
            Value::Number(number, _) => number.parse().ok(),
            _ => None,
        },
        Expr::Nested(inner) => whole_number(inner),
        _ => None,
    }
}

/// The tables of a query nested somewhere; its conditions count as one.
fn query_tables(query: &Query, ctes: &Ctes<'_>, walk: &mut Walk, depth: usize) {
    let mut inner = ctes_of(query);
    inner.extend(ctes.iter().copied());
    set_tables(&query.body, &inner, walk, depth + 1);
}

fn set_tables(body: &SetExpr, ctes: &Ctes<'_>, walk: &mut Walk, depth: usize) {
    if depth > MAX_DEPTH || !walk.step() {
        return;
    }
    match body {
        SetExpr::Select(select) => {
            let joined = select_tables(select, ctes, walk, depth, false);
            if select.selection.is_some() || select.having.is_some() || joined > 0 {
                walk.read.undescribed += 1;
            }
        }
        SetExpr::Query(query) => query_tables(query, ctes, walk, depth),
        SetExpr::SetOperation { left, right, .. } => {
            set_tables(left, ctes, walk, depth + 1);
            set_tables(right, ctes, walk, depth + 1);
        }
        _ => {}
    }
}

/// Reads the tables of a SELECT, and returns how many conditions its joins
/// add beyond a plain equality of two columns. The outermost SELECT counts
/// each of them and keeps its table aliases.
fn select_tables(
    select: &Select,
    ctes: &Ctes<'_>,
    walk: &mut Walk,
    depth: usize,
    outermost: bool,
) -> u32 {
    let mut joined = 0;
    for tables in &select.from {
        table_names(&tables.relation, ctes, walk, depth, outermost);
        for join in &tables.joins {
            table_names(&join.relation, ctes, walk, depth, outermost);
            joined += join_conditions(join);
        }
    }
    if outermost {
        walk.read.undescribed += joined;
    }
    joined
}

/// Conditions of a join's ON beyond plain equalities of two columns.
fn join_conditions(join: &Join) -> u32 {
    let on = match &join.join_operator {
        JoinOperator::Join(JoinConstraint::On(on))
        | JoinOperator::Inner(JoinConstraint::On(on))
        | JoinOperator::Left(JoinConstraint::On(on))
        | JoinOperator::LeftOuter(JoinConstraint::On(on))
        | JoinOperator::Right(JoinConstraint::On(on))
        | JoinOperator::RightOuter(JoinConstraint::On(on))
        | JoinOperator::FullOuter(JoinConstraint::On(on))
        | JoinOperator::CrossJoin(JoinConstraint::On(on)) => on,
        _ => return 0,
    };
    let mut parts = Vec::new();
    conjuncts(on, &mut parts);
    let keys = |part: &&Expr| {
        matches!(part, Expr::BinaryOp { left, op: BinaryOperator::Eq, right }
            if column(left).is_some() && column(right).is_some())
    };
    u32::try_from(parts.iter().filter(|part| !keys(part)).count()).unwrap_or(u32::MAX)
}

fn table_names(
    table: &TableFactor,
    ctes: &Ctes<'_>,
    walk: &mut Walk,
    depth: usize,
    outermost: bool,
) {
    if depth > MAX_DEPTH || !walk.step() {
        return;
    }
    match table {
        TableFactor::Table { name, alias, .. } => {
            let Some(ObjectNamePart::Identifier(last)) = name.0.last() else {
                return;
            };
            let cte = match name.0.as_slice() {
                [_] => ctes
                    .iter()
                    .find(|(cte, _)| cte.eq_ignore_ascii_case(&last.value)),
                _ => None,
            };
            if let Some((_, query)) = cte {
                // A CTE reads the tables it is made of, read once however
                // often it is named, itself included.
                if walk
                    .expanded
                    .insert(std::ptr::from_ref::<Query>(query) as usize)
                {
                    query_tables(query, ctes, walk, depth);
                }
                return;
            }
            if outermost {
                let named = alias
                    .as_ref()
                    .map_or(&last.value, |alias| &alias.name.value);
                walk.aliases
                    .push((named.to_lowercase(), last.value.clone()));
            }
            let read = &mut walk.read;
            if !read
                .tables
                .iter()
                .any(|seen| seen.eq_ignore_ascii_case(&last.value))
            {
                if read.tables.len() < MAX_TABLES {
                    read.tables.push(last.value.clone());
                } else {
                    read.tables_omitted += 1;
                }
            }
        }
        TableFactor::Derived { subquery, .. } => query_tables(subquery, ctes, walk, depth),
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => {
            table_names(&table_with_joins.relation, ctes, walk, depth + 1, outermost);
            for join in &table_with_joins.joins {
                table_names(&join.relation, ctes, walk, depth + 1, outermost);
                let joined = join_conditions(join);
                walk.read.undescribed += if outermost {
                    joined
                } else {
                    u32::from(joined > 0)
                };
            }
        }
        _ => {}
    }
}

fn add_conditions(selection: &Expr, walk: &mut Walk) {
    let mut parts = Vec::new();
    conjuncts(selection, &mut parts);
    let several = walk.read.tables.len() + walk.read.tables_omitted as usize > 1;
    for part in parts {
        if !walk.step() {
            return;
        }
        match condition(part) {
            Some(mut found) if walk.read.conditions.len() < MAX_CONDITIONS => {
                if several {
                    let named = condition_column(part).and_then(qualifier);
                    found.table = named.and_then(|named| {
                        walk.aliases
                            .iter()
                            .find(|(alias, _)| *alias == named)
                            .map(|(_, table)| table.clone())
                    });
                }
                walk.read.conditions.push(found);
            }
            _ => walk.read.undescribed += 1,
        }
    }
}

fn conjuncts<'a>(expr: &'a Expr, parts: &mut Vec<&'a Expr>) {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            conjuncts(left, parts);
            conjuncts(right, parts);
        }
        Expr::Nested(inner)
            if matches!(
                inner.as_ref(),
                Expr::BinaryOp {
                    op: BinaryOperator::And,
                    ..
                }
            ) =>
        {
            conjuncts(inner, parts)
        }
        other => parts.push(other),
    }
}

/// A conjunct that compares one column with literal values.
fn condition(expr: &Expr) -> Option<PlainCondition> {
    let one = |column: String, operator, value: String| PlainCondition {
        column,
        table: None,
        operator,
        values: vec![value],
        values_omitted: 0,
    };
    match expr {
        Expr::Nested(inner) => condition(inner),
        Expr::BinaryOp { left, op, right } => {
            let operator = |op: &BinaryOperator| {
                Some(match op {
                    BinaryOperator::Eq => ToolCallReadOperator::Equals,
                    BinaryOperator::NotEq => ToolCallReadOperator::NotEquals,
                    BinaryOperator::Lt => ToolCallReadOperator::Less,
                    BinaryOperator::LtEq => ToolCallReadOperator::AtMost,
                    BinaryOperator::Gt => ToolCallReadOperator::Greater,
                    BinaryOperator::GtEq => ToolCallReadOperator::AtLeast,
                    _ => return None,
                })
            };
            let flipped = |op: &BinaryOperator| match op {
                BinaryOperator::Lt => BinaryOperator::Gt,
                BinaryOperator::LtEq => BinaryOperator::GtEq,
                BinaryOperator::Gt => BinaryOperator::Lt,
                BinaryOperator::GtEq => BinaryOperator::LtEq,
                other => other.clone(),
            };
            if let (Some(column), Some(value)) = (column(left), literal(right)) {
                Some(one(column, operator(op)?, value))
            } else if let (Some(value), Some(column)) = (literal(left), column(right)) {
                Some(one(column, operator(&flipped(op))?, value))
            } else {
                None
            }
        }
        Expr::IsNull(inner) => Some(PlainCondition {
            column: column(inner)?,
            table: None,
            operator: ToolCallReadOperator::IsEmpty,
            values: Vec::new(),
            values_omitted: 0,
        }),
        Expr::IsNotNull(inner) => Some(PlainCondition {
            column: column(inner)?,
            table: None,
            operator: ToolCallReadOperator::IsNotEmpty,
            values: Vec::new(),
            values_omitted: 0,
        }),
        Expr::In {
            expr,
            target: sqlparser::ast::InTarget::List(list),
            negated,
            global: false,
        } => {
            let column = column(expr)?;
            let values = list.iter().map(literal).collect::<Option<Vec<_>>>()?;
            if values.is_empty() {
                return None;
            }
            let omitted = values.len().saturating_sub(MAX_CONDITION_VALUES);
            Some(PlainCondition {
                column,
                table: None,
                operator: if *negated {
                    ToolCallReadOperator::NotIn
                } else {
                    ToolCallReadOperator::In
                },
                values: values.into_iter().take(MAX_CONDITION_VALUES).collect(),
                values_omitted: u32::try_from(omitted).unwrap_or(u32::MAX),
            })
        }
        Expr::Between {
            expr,
            negated: false,
            low,
            high,
        } => Some(PlainCondition {
            column: column(expr)?,
            table: None,
            operator: ToolCallReadOperator::Between,
            values: vec![literal(low)?, literal(high)?],
            values_omitted: 0,
        }),
        Expr::Like {
            negated: false,
            any: false,
            expr,
            pattern,
            escape_char: None,
        } => {
            let column = column(expr)?;
            let pattern = literal(pattern)?;
            let (operator, value) = like_pattern(&pattern)?;
            Some(one(column, operator, value))
        }
        _ => None,
    }
}

/// `%x%`, `x%`, `%x` and `x` as words; any other pattern is not said.
fn like_pattern(pattern: &str) -> Option<(ToolCallReadOperator, String)> {
    let leading = pattern.starts_with('%');
    let rest = pattern.strip_prefix('%').unwrap_or(pattern);
    let trailing = rest.ends_with('%');
    let middle = rest.strip_suffix('%').unwrap_or(rest);
    if middle.is_empty() || middle.contains(['%', '_', '[']) {
        return None;
    }
    let operator = match (leading, trailing) {
        (true, true) => ToolCallReadOperator::Contains,
        (false, true) => ToolCallReadOperator::StartsWith,
        (true, false) => ToolCallReadOperator::EndsWith,
        (false, false) => ToolCallReadOperator::Equals,
    };
    Some((operator, middle.to_string()))
}

/// The expression of the column a simple condition compares.
fn condition_column(expr: &Expr) -> Option<&Expr> {
    match expr {
        Expr::Nested(inner) => condition_column(inner),
        Expr::BinaryOp { left, right, .. } => [left, right]
            .into_iter()
            .map(Box::as_ref)
            .find(|side| column(side).is_some()),
        Expr::IsNull(inner) | Expr::IsNotNull(inner) => Some(inner),
        Expr::In { expr, .. } | Expr::Between { expr, .. } | Expr::Like { expr, .. } => Some(expr),
        _ => None,
    }
}

/// The table or alias a column names before its own name, lower case.
fn qualifier(expr: &Expr) -> Option<String> {
    match expr {
        Expr::CompoundIdentifier(parts) if parts.len() >= 2 => {
            Some(parts[parts.len() - 2].value.to_lowercase())
        }
        Expr::Nested(inner) => qualifier(inner),
        _ => None,
    }
}

fn column(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Identifier(ident) => Some(ident.value.clone()),
        Expr::CompoundIdentifier(parts) => parts.last().map(|ident| ident.value.clone()),
        Expr::Nested(inner) => column(inner),
        _ => None,
    }
}

/// A literal as a value to say. A string holding a backslash is left out:
/// dialects disagree on whether it escapes, so the value is not certain.
fn literal(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Value(value) => match &value.value {
            Value::Number(number, _) => Some(number.clone()),
            Value::SingleQuotedString(text) | Value::NationalStringLiteral(text)
                if !text.contains('\\') =>
            {
                Some(text.clone())
            }
            Value::Boolean(flag) => Some(flag.to_string()),
            _ => None,
        },
        Expr::UnaryOp {
            op: UnaryOperator::Minus,
            expr,
        } => match expr.as_ref() {
            Expr::Value(value) => match &value.value {
                Value::Number(number, _) => Some(format!("-{number}")),
                _ => None,
            },
            _ => None,
        },
        Expr::Nested(inner) => literal(inner),
        _ => None,
    }
}

/// The value of the one condition on the table's own key (`id`, `<table>id`
/// or `<table>_id` of the only table), taken out of the conditions: the
/// record the read looks up.
pub(super) fn take_key_lookup(read: &mut PlainRead) -> Option<String> {
    let [table] = read.tables.as_slice() else {
        return None;
    };
    if read.tables_omitted > 0 {
        return None;
    }
    let table = table.to_lowercase();
    let is_key = |column: &str| {
        let column = column.to_lowercase();
        column == "id" || column == format!("{table}id") || column == format!("{table}_id")
    };
    let mut keys = read.conditions.iter().enumerate().filter(|(_, condition)| {
        condition.operator == ToolCallReadOperator::Equals
            && condition.values.len() == 1
            && is_key(&condition.column)
    });
    let (at, _) = keys.next()?;
    if keys.next().is_some() {
        return None;
    }
    read.conditions.remove(at).values.pop()
}

#[cfg(test)]
mod tests;
