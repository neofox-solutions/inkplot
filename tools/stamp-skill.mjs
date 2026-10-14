// Marks a skill with the version of inkplot it was written for. The mark is in the front matter (`metadata` is the part of a skill's
// header that the format leaves to the author), where `inkplot install-skill` reads it to tell an old copy from a current one, and
// the text `{{version}}` anywhere in the skill becomes the version, so a command in it can name the release it belongs to.
export function stampSkill(text, version) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error('a skill starts with a front matter block');
  if (/^metadata:/m.test(m[1])) throw new Error('the skill already has a metadata block');
  const front = `---\n${m[1]}\nmetadata:\n  generator: inkplot\n  version: "${version}"\n---`;
  return (front + text.slice(m[0].length)).replaceAll('{{version}}', version);
}
