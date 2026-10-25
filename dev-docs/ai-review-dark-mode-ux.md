# AI review detail: dark-mode color proposal

The auto-moderation trace is currently an inline `AutoModerationTracePanel` in `apps/web/src/features/posts/PostsPage.tsx`. An isolated reusable component would be dead code until that page imports it; this change deliberately leaves the concurrently edited page untouched. Apply the following class-only diff to the trace panel when integrating it.

## Exact class/token diff

```diff
- <section className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm" aria-label="自动审核规则判定记录">
+ <section className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900" aria-label="自动审核规则判定记录">
...
- <h3 className="text-xs font-bold text-slate-700">服务端规则判定</h3>
+ <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200">服务端规则判定</h3>
...
- <li key={`${rule.ruleId}-${index}`} className="grid gap-0.5 border-l-2 border-slate-200 pl-2.5">
+ <li key={`${rule.ruleId}-${index}`} className="grid gap-0.5 border-l-2 border-slate-200 pl-2.5 dark:border-slate-700">
...
- <span className="font-semibold text-slate-700">{rule.ruleId}</span>
+ <span className="font-semibold text-slate-700 dark:text-slate-200">{rule.ruleId}</span>
...
- <span className="text-slate-500">字面子串匹配</span>
+ <span className="text-slate-500 dark:text-slate-400">字面子串匹配</span>
...
- <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{rule.explanation}</p>
+ <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 dark:text-slate-300">{rule.explanation}</p>
...
- <p className="border-t border-slate-100 pt-2 text-xs leading-5 text-slate-600">{trace.explanation}</p>
+ <p className="border-t border-slate-100 pt-2 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:text-slate-300">{trace.explanation}</p>
```

The existing `Badge` outline variant already supplies dark-mode styling in `components/ui/badge.tsx`; no badge override is proposed. The slate surface/text/border choices follow existing Campux dark surfaces (`dark:bg-slate-900`, `dark:border-slate-800`) and maintain readable hierarchy instead of adding new palette tokens. Keep status badges tied to their existing component styles.

## Accessibility and scope

- Retain the existing semantic `<section>`, accessible label, ordered rule list, and visible outcome labels.
- The muted explanation text becomes `dark:text-slate-300`, while metadata uses `dark:text-slate-400` and headings use `dark:text-slate-200` for contrast hierarchy.
- No caller, page, types, behavior, or backend changes are needed beyond applying this targeted class diff.
