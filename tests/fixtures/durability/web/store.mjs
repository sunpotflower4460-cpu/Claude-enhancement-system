const key = "field-notes-v1";
export function load() {
  return JSON.parse(
    localStorage.getItem(key) || '{"notes":[],"owner":"Explorer"}',
  );
}
export function save(state) {
  localStorage.setItem(key, JSON.stringify(state));
}
