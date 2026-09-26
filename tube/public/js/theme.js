// Runs before first paint so a saved light/dark choice never flashes the other theme.
try {
  const theme = JSON.parse(localStorage.getItem("mt:theme"));
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  /* no stored preference */
}
