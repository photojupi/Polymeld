import chalk from "chalk";

export function contextCommand(session) {
  const slots = session.sharedContext.slots;

  if (slots.size === 0) {
    console.log(chalk.gray("  SharedContext가 비어있습니다."));
    return;
  }

  console.log(chalk.bold("\n  🧠 SharedContext 슬롯\n"));
  for (const [name, slot] of slots) {
    const valueStr = typeof slot.value === "string"
      ? slot.value
      : (JSON.stringify(slot.value) ?? "(undefined)");
    const valuePreview = valueStr.substring(0, 60);
    const meta = slot.metadata;
    console.log(`  ${chalk.cyan(name)} (v${meta.version}, by ${meta.author})`);
    console.log(chalk.gray(`    ${valuePreview}${valuePreview.length >= 60 ? "..." : ""}`));
  }
  console.log();
}
