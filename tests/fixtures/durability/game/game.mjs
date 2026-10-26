const canvas = document.querySelector("canvas"),
  ctx = canvas.getContext("2d");
let x, y, score, status;
const parcels = [1, 2, 3];
function draw() {
  ctx.clearRect(0, 0, 600, 240);
  ctx.fillStyle = "#e0ad16";
  parcels
    .filter((p) => p > score)
    .forEach((p) => ctx.fillRect(p * 120 + 12, 22, 26, 26));
  ctx.fillStyle = "#b22537";
  ctx.fillRect(12, 102, 26, 26);
  ctx.fillStyle = "#145a91";
  ctx.fillRect(x * 120 + 12, y * 80 + 22, 26, 26);
  document.querySelector("#score").textContent = score;
  document.querySelector("#status").textContent = status;
}
function restart() {
  x = 0;
  y = 0;
  score = 0;
  status = "Playing";
  draw();
}
addEventListener("keydown", (event) => {
  if (!event.key.startsWith("Arrow")) return;
  event.preventDefault();
  if (status !== "Playing") return;
  if (event.key === "ArrowRight") x = Math.min(4, x + 1);
  if (event.key === "ArrowLeft") x = Math.max(0, x - 1);
  if (event.key === "ArrowDown") y = Math.min(2, y + 1);
  if (event.key === "ArrowUp") y = Math.max(0, y - 1);
  if (x === 0 && y === 1) status = "Lost";
  if (y === 0 && x === score + 1 && parcels.includes(x)) score++;
  if (score === 3) status = "Won";
  draw();
});
document.querySelector("#restart").onclick = restart;
restart();
