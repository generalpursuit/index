// The square whose color carries a link's category; empty until the page says what it is.
// Shared by every link list; the marker class remains available to scroll hooks/tests.
export const categoryMarkClassName =
  "category-mark justify-self-center w-2 h-2 rounded-[2px] bg-category-other [&[data-category='article']]:bg-category-article [&[data-category='video']]:bg-category-video [&[data-category='music']]:bg-category-music [&[data-category='podcast']]:bg-category-podcast [&[data-category='book']]:bg-category-book [&[data-category='tool']]:bg-category-tool [&[data-category='note']]:bg-category-note [&[data-empty]]:bg-transparent [&[data-empty]]:[box-shadow:inset_0_0_0_1px_var(--subtle-foreground)]";
