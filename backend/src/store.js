const fs = require("fs");
const path = require("path");

/** Atomic write: a crash mid-save can never corrupt the state file. */
function save(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;

    throw new Error(
      `Cannot safely load state file "${file}": ${error.message}`,
      { cause: error },
    );
  }
}

function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

module.exports = { save, load, appendLine };
