import { load, save } from "./store.mjs";
let state = load();
const screen = document.querySelector("#screen");
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
function render() {
  const route = location.hash || "#notes";
  if (route === "#new") {
    screen.innerHTML =
      '<h2>New note</h2><form><label>Title <input name="title" required maxlength="100"></label><button>Save note</button></form>';
    screen.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      state.notes.push({
        title: new FormData(event.target).get("title"),
        done: false,
      });
      save(state);
      location.hash = "notes";
    };
  } else if (route === "#settings") {
    screen.innerHTML = `<h2>Settings</h2><form><label>Owner <input name="owner" value="${escape(state.owner)}" required></label><button>Save settings</button><p role="status"></p></form>`;
    screen.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      state.owner = new FormData(event.target).get("owner");
      save(state);
      screen.querySelector('[role="status"]').textContent = "Saved";
    };
  } else {
    screen.innerHTML = `<h2>${escape(state.owner)}'s notes</h2><p id="summary">${state.notes.filter((n) => n.done).length}/${state.notes.length} complete</p><ul>${state.notes.map((note, i) => `<li><label><input type="checkbox" data-index="${i}" ${note.done ? "checked" : ""}> ${escape(note.title)}</label></li>`).join("")}</ul>`;
    screen.querySelectorAll("[data-index]").forEach(
      (input) =>
        (input.onchange = () => {
          state.notes[Number(input.dataset.index)].done = input.checked;
          save(state);
          render();
        }),
    );
  }
}
addEventListener("hashchange", render);
render();
