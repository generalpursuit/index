// Sets `--category-color` from the element's `data-category`, for it and what it holds.
export const categoryColorClassName =
  "[--category-color:var(--category-other)] [&[data-category='article']]:[--category-color:var(--category-article)] [&[data-category='video']]:[--category-color:var(--category-video)] [&[data-category='music']]:[--category-color:var(--category-music)] [&[data-category='podcast']]:[--category-color:var(--category-podcast)] [&[data-category='book']]:[--category-color:var(--category-book)] [&[data-category='tool']]:[--category-color:var(--category-tool)] [&[data-category='note']]:[--category-color:var(--category-note)]";
// The square whose color carries a link's category; empty until the page says what it is.
// Shared by every link list; the marker class remains available to scroll hooks/tests.
export const categoryMarkClassName =
  "category-mark justify-self-center w-2 h-2 rounded-[2px] bg-[var(--category-color)] [&[data-empty]]:bg-transparent [&[data-empty]]:[box-shadow:inset_0_0_0_1px_var(--subtle-foreground)] " +
  categoryColorClassName;
