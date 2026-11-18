//! The words a natural wording may add when the configuration lists none for
//! the language: articles, a copula, "geht" and "lautet", "Wert". These are
//! the words the model added in the measured run (2026-11-18); everything
//! else a wording says must be the precise piece's own words, in order. A
//! content package replaces a language's list with
//! `approval_speech.words.<language>`.

pub const WORDS_DE: &[&str] = &[
    "der", "die", "das", "den", "dem", "des", "ist", "sind", "geht", "gehen", "lautet", "lauten",
    "wert",
];

pub const WORDS_EN: &[&str] = &["the", "is", "are", "goes", "value"];
