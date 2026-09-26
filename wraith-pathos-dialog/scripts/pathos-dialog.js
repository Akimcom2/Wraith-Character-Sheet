const MODULE_ID = "wraith-pathos-dialog";
const PATHOS_PATHS = [
  "system.advantages.pathos.temporary",
  "system.advantages.pathos.value"
];
const DISPLAY_RENAMES = new Map([
  ["Привлекательность", "Внешность"],
  ["Бюрократия", "Законы"],
  ["Арканосы", "Арканои"],
  ["Жезнь", "Жизнь"],
  ["Жизень", "Жизнь"]
]);
const WRAITH_POWER_TYPES = new Set(["wod.types.arcanoi", "wod.types.arcanoipower"]);
const OTHER_POWER_TYPES = new Set([
  "wod.types.horror", "wod.types.stain",
  "wod.types.discipline", "wod.types.disciplinepower",
  "wod.types.gift", "wod.types.giftpower",
  "wod.types.art", "wod.types.artpower",
  "wod.types.hekau", "wod.types.hekaupower",
  "wod.types.numina", "wod.types.numinapower"
]);
const LARGE_BIO_LABELS = new Set([
  "натура", "маска", "психоз", "амплуа", "жизнь", "смерть", "сожаления", "тень"
]);

function elementFrom(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function pathosData(actor) {
  // The universal PC sheet stores resources as embedded Advantage items.
  if (String(actor?.type ?? "").toLowerCase() === "pc") {
    const poolItem = Array.from(actor.items ?? []).find(item =>
      String(item?.type ?? "").toLowerCase() === "advantage"
      && String(item?.system?.id ?? "").toLowerCase() === "pathos"
    );
    const value = Number(poolItem?.system?.temporary);
    if (poolItem && Number.isFinite(value)) {
      return {
        value,
        update: next => poolItem.update({ "system.temporary": next })
      };
    }
  }

  for (const path of PATHOS_PATHS) {
    const raw = foundry.utils.getProperty(actor, path);
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return {
        path,
        value,
        update: next => actor.update({ [path]: next })
      };
    }
  }
  return null;
}

function hasArcanoi(actor) {
  return actor?.system?.settings?.hasarcanois === true
    || actor?.system?.settings?.powers?.hasarcanois === true
    || Array.from(actor?.items ?? []).some(item =>
      WRAITH_POWER_TYPES.has(String(item?.system?.type ?? "").toLowerCase())
    );
}

function isWraithActor(actor) {
  const type = String(actor?.type ?? "").toLowerCase();
  return type === "wraith" || (type === "pc" && (hasArcanoi(actor) || Boolean(pathosData(actor))));
}

function validWraithActor(actor) {
  return actor?.documentName === "Actor" && isWraithActor(actor);
}

function actorFrom(app, root = null) {
  const candidates = [
    game.actors?.get?.(root?.dataset?.wraithPathosActorId),
    game.actors?.get?.(root?.closest?.(".window-app, .application")?.dataset?.wraithPathosActorId),
    app?.actor,
    app?.item,
    app?.document,
    app?.object,
    app?.options?.actor,
    app?.options?.item,
    app?.options?.document,
    app?.data?.actor,
    app?.data?.item,
    canvas?.tokens?.controlled?.[0]?.actor,
    game.user?.character
  ].filter(Boolean);

  const queue = [...candidates];
  const visited = new Set();
  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    if (validWraithActor(candidate)) return candidate;

    for (const linked of [
      candidate.actor, candidate.parent, candidate.document,
      candidate.object, candidate.item, candidate.token?.actor
    ]) {
      if (linked && !visited.has(linked)) queue.push(linked);
    }
  }

  const windowRoot = root?.closest?.(".window-app, .application") ?? root;
  const visibleTitles = [
    app?.title,
    windowRoot?.querySelector?.(".window-title")?.textContent,
    windowRoot?.querySelector?.("header h4, header h3")?.textContent
  ].filter(value => typeof value === "string" && value.trim());
  const wraiths = game.actors?.filter?.(validWraithActor) ?? [];
  for (const title of visibleTitles) {
    const normalized = title.trim().toLocaleLowerCase("ru-RU");
    const named = wraiths.find(actor => {
      const name = String(actor.name ?? "").trim().toLocaleLowerCase("ru-RU");
      return name && (normalized === name || normalized.startsWith(`${name} `));
    });
    if (named) return named;
  }

  if (!game.user?.isGM) {
    const owned = wraiths.filter(actor => actor.isOwner);
    if (owned.length === 1) return owned[0];
  }
  return null;
}

function renamedText(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [source, replacement] of DISPLAY_RENAMES) {
    result = result.split(source).join(replacement);
  }
  return result;
}

function correctWraithLabels(app, root, suppliedActor = null) {
  const actor = suppliedActor ?? actorFrom(app, root);
  const rootText = root.textContent ?? "";
  const isWraithRoll = /Пул\s+костей/i.test(rootText) && /(?:Бросок|Закрыть|Roll|Close)/i.test(rootText);
  const isWraith = Boolean(actor) || /Призрак:\s*Забвение|Wraith/i.test(rootText) || isWraithRoll;
  if (!isWraith) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, textarea, [contenteditable='true']")) continue;
    node.textContent = renamedText(node.textContent);
  }

  for (const element of root.querySelectorAll("[placeholder], [title], [aria-label], [data-tooltip]")) {
    for (const attribute of ["placeholder", "title", "aria-label", "data-tooltip"]) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const corrected = renamedText(current);
      if (corrected !== current) element.setAttribute(attribute, corrected);
    }
  }

  for (const label of root.querySelectorAll('[data-tab="bio"] .floating-label')) {
    const text = String(label.textContent ?? "").trim().toLocaleLowerCase("ru-RU");
    label.classList.toggle("wraith-readable-bio-label", LARGE_BIO_LABELS.has(text));
  }
  const smallGearHeadings = new Set(["снаряжение", "деньги", "прочие предметы"]);
  for (const heading of root.querySelectorAll('[data-tab="gear"] .sheet-banner-text')) {
    const text = String(heading.textContent ?? "").trim().toLocaleLowerCase("ru-RU");
    heading.classList.toggle("wraith-compact-gear-heading", smallGearHeadings.has(text));
  }
  const readableMoneyLabels = new Set(["при себе", "в банке"]);
  for (const label of root.querySelectorAll('[data-tab="gear"] .floating-label')) {
    const text = String(label.textContent ?? "").trim().toLocaleLowerCase("ru-RU");
    label.classList.toggle("wraith-readable-money-label", readableMoneyLabels.has(text));
  }
}

function willpowerCheckbox(root) {
  const direct = root.querySelector(
    'input[type="checkbox"][name*="willpower" i], input[type="checkbox"][id*="willpower" i], input[type="checkbox"][class*="willpower" i]'
  );
  if (direct) return direct;

  return [...root.querySelectorAll('input[type="checkbox"]')].find(input => {
    const container = input.closest("label, .form-group, .flexrow, div") ?? input.parentElement;
    return /сил[ау]\s+воли|willpower/i.test(container?.textContent ?? "");
  });
}

function hasSectionHeading(root, pattern) {
  return [...root.querySelectorAll("*")].some(element => {
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(" ")
      .trim();
    return pattern.test(ownText);
  });
}

function isArcanosRoll(app, root, actor) {
  const objectTypes = [
    app?.object?.system?.type,
    app?.item?.system?.type,
    app?.document?.system?.type,
    app?.object?.type,
    app?.item?.type,
    app?.document?.type
  ].map(value => String(value ?? "").toLowerCase());
  if (objectTypes.includes("wod.types.arcanoipower")) return true;
  if (objectTypes.some(type => type === "wod.types.arcanoi" || OTHER_POWER_TYPES.has(type))) return false;

  const itemId = app?.object?._id ?? app?.object?.id
    ?? app?.item?._id ?? app?.item?.id
    ?? app?.document?._id ?? app?.document?.id;
  const embeddedItem = itemId ? actor?.items?.get?.(itemId) : null;
  const embeddedType = String(embeddedItem?.system?.type ?? "").toLowerCase();
  if (embeddedType === "wod.types.arcanoipower") return true;
  if (OTHER_POWER_TYPES.has(embeddedType)) return false;

  const sheetType = String(
    app?.object?.sheettype ?? app?.item?.sheettype ?? app?.document?.sheettype ?? app?.options?.sheettype ?? ""
  ).toLowerCase();
  const hasWraithDialogMarker = sheetType === "wraithdialog"
    || root.matches?.(".wraithDialog, .wraithdialog")
    || Boolean(root.querySelector?.("form.wraithDialog, form.wraithdialog"))
    || Boolean(root.closest?.(".wraithDialog, .wraithdialog"));
  const hasDescription = hasSectionHeading(root, /^(описание|description)$/i);
  const hasSystem = hasSectionHeading(root, /^(система|system)$/i);
  return Boolean(actor && isWraithActor(actor) && hasWraithDialogMarker && hasDescription && hasSystem);
}

const PATHOS_NUMBER_WORDS = new Map([
  ["один", 1], ["одна", 1], ["одно", 1],
  ["два", 2], ["две", 2], ["три", 3], ["четыре", 4],
  ["пять", 5], ["шесть", 6], ["семь", 7], ["восемь", 8],
  ["девять", 9], ["десять", 10]
]);

function pathosCostFromText(root) {
  // Read only an explicit cost phrase. Other numbers in an Arcanos description
  // (difficulty, successes and duration) must never become the Pathos cost.
  const text = (root.textContent ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const number = "(\\d+|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)";
  const point = "(?:пункт(?:а|ов)?|очк(?:о|а|ов))?";
  const pathos = "пафос(?:а|у|ом|е)?";
  const patterns = [
    new RegExp(`(?:стоит|стоимость(?:ю)?|цена|обходится|обойдется|требует)\\s*(?:в|составляет|равна?)?\\s*[:—-]?\\s*${number}(?:\\s+(?:один|одна|одно))?\\s*${point}\\s*${pathos}`, "iu"),
    new RegExp(`(?:потратить|потрачено|затратить|затрачивается|израсходовать|расходуется|списать|списывается)\\s*${number}\\s*${point}\\s*${pathos}`, "iu"),
    new RegExp(`(?:стоимость|цена)\\s*[:—-]?\\s*${number}\\s*${point}\\s*${pathos}`, "iu")
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const token = match[1].toLocaleLowerCase("ru-RU");
    const value = /^\d+$/.test(token) ? Number.parseInt(token, 10) : PATHOS_NUMBER_WORDS.get(token);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return 1;
}

function rollButton(root) {
  const direct = root.querySelector(
    '[data-button="roll"], [data-action="roll"], button.roll, button[name="roll"]'
  );
  if (direct) return direct;

  return [...root.querySelectorAll("button")].find(button =>
    /^\s*(бросок|бросить|roll)\s*$/i.test(button.textContent ?? "")
  );
}

function selectedDifficulty(root, app = null) {
  const selected = root.querySelector([
    ".dialog-difficulty-button.active",
    ".dialog-difficulty-button[aria-pressed='true']",
    "[data-difficulty].active",
    "input[name*='difficulty' i]:checked",
    "select[name*='difficulty' i]"
  ].join(", "));
  const value = Number.parseInt(selected
    ? selected.value ?? selected.dataset?.difficulty ?? selected.dataset?.index ?? selected.textContent
    : app?.object?.difficulty ?? app?.item?.difficulty ?? app?.document?.difficulty,
    10
  );
  return Number.isInteger(value) && value >= 2 && value <= 10 ? value : null;
}

function difficultyContainer(root) {
  const heading = [...root.querySelectorAll("*")].find(element => {
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(" ")
      .trim();
    return /^сложность$/i.test(ownText);
  });

  let panel = heading?.parentElement;
  while (panel && panel !== root) {
    const numbered = [...panel.querySelectorAll("button, a, label, span, div")].filter(element =>
      /^(2|3|4|5|6|7|8|9|10)$/.test(element.textContent?.trim() ?? "")
    );
    if (numbered.length >= 5) return panel;
    panel = panel.parentElement;
  }

  const buttons = [...root.querySelectorAll("button, a")].filter(button =>
    /^(2|3|4|5|6|7|8|9|10)$/.test(button.textContent?.trim() ?? "")
  );
  if (buttons.length < 5) return null;

  let candidate = buttons[0].parentElement;
  while (candidate && candidate !== root) {
    const ownButtons = [...candidate.querySelectorAll("button")].filter(button =>
      /^(2|3|4|5|6|7|8|9|10)$/.test(button.textContent?.trim() ?? "")
    );
    if (ownButtons.length >= 5 && /сложност|difficulty/i.test(candidate.textContent ?? "")) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function insertControls(root, willpower, actor, current, defaultCost) {
  const hasResource = Number.isFinite(current);
  const row = document.createElement("div");
  row.className = "wraith-pathos-spend";
  row.innerHTML = `
    <div class="wraith-pathos-check" data-pathos-use role="checkbox" aria-checked="true" tabindex="0">
      <span class="wraith-pathos-box" aria-hidden="true"></span>
      <span>Использовать Пафос</span>
    </div>
    <label class="wraith-pathos-cost">
      <span>Стоимость</span>
      <input type="number" data-pathos-cost value="${defaultCost}" min="1" max="${Math.max(1, current ?? 0, defaultCost)}" step="1">
    </label>
    <span class="wraith-pathos-current${hasResource ? "" : " is-missing"}" title="Текущий запас Пафоса">${hasResource ? `Доступно: ${current}` : "Запас Пафоса не настроен"}</span>
  `;

  // The WoD20 willpower checkbox sits inside a horizontal flex container.
  // Inserting next to it makes the new panel a flex item and the following
  // Difficulty panel can cover it. Put Pathos before Difficulty as its own row.
  const difficulty = difficultyContainer(root);
  if (difficulty) {
    difficulty.insertAdjacentElement("beforebegin", row);

    const syncWidth = () => {
      if (!difficulty.isConnected || !row.isConnected) return;
      row.style.width = `${difficulty.getBoundingClientRect().width}px`;
    };
    syncWidth();
    if (globalThis.ResizeObserver) {
      const observer = new ResizeObserver(syncWidth);
      observer.observe(difficulty);
    }
  } else {
    const anchor = willpower.closest("label, .form-group") ?? willpower.parentElement;
    anchor?.insertAdjacentElement("afterend", row);
  }
  root.dataset.wraithPathosReady = "true";

  const checkbox = row.querySelector("[data-pathos-use]");
  const cost = row.querySelector("[data-pathos-cost]");
  checkbox.checked = true;

  const setChecked = checked => {
    checkbox.checked = Boolean(checked);
    checkbox.setAttribute("aria-checked", String(checkbox.checked));
    row.classList.toggle("is-active", checkbox.checked);
  };
  setChecked(true);

  // WoD20 overrides native checkbox behavior in roll forms. This standalone
  // accessible switch does not depend on the system's checkbox listeners.
  checkbox.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setChecked(!checkbox.checked);
  }, true);
  checkbox.addEventListener("keydown", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setChecked(!checkbox.checked);
  }, true);

  // FormApplication listens to input/change events from every form control and
  // re-renders the dialog. Keep the local cost field outside that mechanism.
  for (const eventName of ["pointerdown", "mousedown", "click", "keydown", "keyup", "input", "change"] ) {
    cost.addEventListener(eventName, event => event.stopImmediatePropagation(), true);
  }

  return { row, checkbox, cost };
}

function enhance(app, html) {
  const root = elementFrom(html) ?? app?.element?.[0] ?? app?.element;
  if (!(root instanceof HTMLElement)) return;

  const actor = actorFrom(app, root);
  if (actor) {
    root.dataset.wraithPathosActorId = actor.id;
    const windowRoot = root.closest?.(".window-app, .application");
    if (windowRoot) windowRoot.dataset.wraithPathosActorId = actor.id;
  }
  correctWraithLabels(app, root, actor);
  if (root.dataset.wraithPathosReady === "true") return;

  // Only add Pathos to real Arcanoi rolls, never to regular rolls or Horrors.
  if (!isArcanosRoll(app, root, actor)) return;

  const willpower = willpowerCheckbox(root);
  const button = rollButton(root);
  const resource = actor && pathosData(actor);
  if (!willpower || !button || !actor) return;

  const description = [
    app?.object?.system?.description,
    app?.object?.system?.system,
    app?.item?.system?.description,
    app?.item?.system?.system,
    app?.document?.system?.description,
    app?.document?.system?.system,
    root.textContent
  ].filter(value => typeof value === "string").join(" ");
  const defaultCost = pathosCostFromText({ textContent: description });
  const { row, checkbox, cost } = insertControls(root, willpower, actor, resource?.value ?? null, defaultCost);

  // Recalculate legacy Application height after adding a complete new row.
  requestAnimationFrame(() => {
    try {
      if (typeof app?.setPosition === "function") app.setPosition({ height: "auto" });
    } catch (error) {
      console.debug(`${MODULE_ID} | Dialog resize skipped`, error);
    }
  });

  button.addEventListener("click", async event => {
    if (button.dataset.pathosApproved === "true" || !checkbox.checked) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    // WoD20 represents "Dont Show" as difficulty -1 and aborts its own
    // handler. Validate before spending Pathos to prevent free resource loss.
    if (selectedDifficulty(root, app) === null) {
      const message = game.i18n.localize("wod.dialog.missingdifficulty");
      return ui.notifications.warn(
        message && message !== "wod.dialog.missingdifficulty"
          ? message
          : "Выберите сложность броска. Пафос не потрачен."
      );
    }

    if (!pathosData(actor)) {
      return ui.notifications.error(
        "У этого персонажа не настроен запас Пафоса. Добавьте его в карточку; Пафос не потрачен, бросок не выполнен."
      );
    }

    const live = pathosData(actor);
    const amount = Number.parseInt(cost.value, 10);

    if (!Number.isInteger(amount) || amount < 1) {
      return ui.notifications.warn("Укажите стоимость Арканоя в Пафосе: целое число от 1.");
    }
    if (!live || live.value < amount) {
      return ui.notifications.error(`Недостаточно Пафоса: требуется ${amount}, доступно ${live?.value ?? 0}.`);
    }

    button.disabled = true;
    try {
      await live.update(live.value - amount);
      row.querySelector(".wraith-pathos-current").textContent = `Доступно: ${live.value - amount}`;
      ui.notifications.info(`Пафос: −${amount} (${live.value - amount} осталось)`);

      button.dataset.pathosApproved = "true";
      button.disabled = false;
      button.click();
    } catch (error) {
      button.disabled = false;
      console.error(`${MODULE_ID} | Pathos update failed`, error);
      ui.notifications.error("Не удалось списать Пафос. Бросок отменён.");
    } finally {
      delete button.dataset.pathosApproved;
    }
  }, true);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialized`);
});

Hooks.once("ready", () => {
  let queued = false;
  const correctOpenSheets = () => {
    queued = false;
    for (const root of document.querySelectorAll(".window-app, .application")) {
      if (/Призрак:\s*Забвение/i.test(root.textContent ?? "")) {
        correctWraithLabels(null, root);
      }
    }
  };
  const scheduleCorrection = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(correctOpenSheets);
  };

  new MutationObserver(scheduleCorrection).observe(document.body, {
    childList: true,
    subtree: true
  });
  scheduleCorrection();
});

// WoD20 versions in the wild use both generations of the Foundry application API.
for (const hook of ["renderApplication", "renderDialog", "renderApplicationV2", "renderDialogV2"]) {
  Hooks.on(hook, enhance);
}
