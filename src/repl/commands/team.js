import chalk from "chalk";

export function teamCommand(session) {
  console.log(chalk.bold("\n  👥 팀 구성\n"));

  const personas = session.config.personas;
  for (const [id, persona] of Object.entries(personas)) {
    const onDemand = persona.on_demand ? chalk.gray(" (온디맨드)") : chalk.green(" (상시)");
    const modelColor =
      persona.model === "claude" ? chalk.hex("#D4A574") :
      persona.model === "gemini" ? chalk.hex("#4285F4") :
      chalk.hex("#10A37F");
    const imageTag = persona.image_model ? chalk.gray(` + ${persona.image_model}`) : "";
    console.log(`  ${persona.name} (${persona.role}): ${modelColor(persona.model)}${imageTag}${onDemand}`);
  }
  console.log();
}
