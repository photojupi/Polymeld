import chalk from "chalk";
import { t } from "../../i18n/index.js";

export function teamCommand(session) {
  console.log(chalk.bold(`\n  ${t("repl.team.header")}\n`));

  const personas = session.config.personas;
  for (const [id, persona] of Object.entries(personas)) {
    const modelColor =
      persona.model === "claude" ? chalk.hex("#D4A574") :
      persona.model === "gemini" ? chalk.hex("#4285F4") :
      chalk.hex("#10A37F");
    const imageTag = persona.image_model ? chalk.gray(` + ${persona.image_model}`) : "";
    console.log(`  ${persona.name} (${persona.role}): ${modelColor(persona.model)}${imageTag}`);
  }
  console.log();
}
