import { readFileSync, readdirSync } from "node:fs";
import { layoutOverrideError, type FilmTemplate } from "@gen-story/domain";

const directory = new URL("../assets/templates/", import.meta.url);

export function loadFilmTemplateCatalog() {
  const templates = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const template: FilmTemplate = JSON.parse(
        readFileSync(new URL(name, directory), "utf8"),
      );
      if (
        template.schema !== "film.template@1" ||
        name !== `${template.id}.json` ||
        !/^[a-z0-9-]+$/.test(template.revision) ||
        (template.fixed !== null && template.fixed.transitions.length !== 1) ||
        !/^[a-z0-9-]+$/.test(template.recipe) ||
        !template.bounds.cameraMoves.includes(template.bounds.defaultMove) ||
        !template.bounds.musicKeys.length ||
        !template.bounds.musicArcs.length ||
        Object.entries(template.frame ?? {}).some(
          ([aspect, layout]) =>
            !["16:9", "9:16", "1:1"].includes(aspect) ||
            !layout?.photo ||
            !layout.caption ||
            layoutOverrideError(layout) !== null,
        )
      )
        throw new Error(`Invalid Film template definition: ${name}`);
      return template;
    });
  return {
    list: () => templates,
    get: (id: string) => templates.find((template) => template.id === id),
  };
}
