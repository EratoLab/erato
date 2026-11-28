import type { ShellMenuItem } from "@/lib/shell/contract/systemMenus";

/**
 * What the schema cannot say about a menu: an id names one entry in the
 * whole tree, since a pick comes back as the id alone. Each repeat as a JSON
 * path.
 */
export function menuRuleViolations(items: readonly ShellMenuItem[]): string[] {
  const violations: string[] = [];
  const seen = new Map<string, string>();
  const visit = (list: readonly ShellMenuItem[], path: string) => {
    list.forEach((item, index) => {
      const at = `${path}[${index}]`;
      const first = seen.get(item.id);
      if (first) {
        violations.push(`${at}.id repeats ${first}.id ("${item.id}")`);
      } else {
        seen.set(item.id, at);
      }
      if (item.children) visit(item.children, `${at}.children`);
    });
  };
  visit(items, "items");
  return violations;
}
