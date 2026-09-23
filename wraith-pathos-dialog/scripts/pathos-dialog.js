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

function elementFrom(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function pathosData(actor) {
  for (const path of PATHOS_PATHS) {
    const raw = foundry.utils.getProperty(actor, path);
    const value = Number(raw);
    if (Number.isFinite(value)) return { path, value };
  }
  return null;
}

function actorFrom(app) {
  const candidates = [
    app?.actor,
    app?.item?.actor,
    app?.document?.actor,
    app?.object?.actor,
    app?.options?.actor,
    app?.options?.item?.actor,
    canvas?.tokens?.controlled?.[0]?.actor,
    game.user?.character
  ];

  return candidates.find(candidate => candidate?.documentName === "Actor" && pathosData(candidate));
}

function renamedText(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [source, replacement] of DISPLAY_RENAMES) {
    result = result.split(source).join(replacement);
  }
  return result;
}

function correctWraithLabels(app, root) {
  const actor = actorFrom(app);
  const rootText = root.textContent ?? "";
  const isWraithRoll = /Пул\s+костей/i.test(rootText) && /(?:Бросок|Закрыть|Roll|Close)/i.test(rootText);
  const isWraith = Boolean(actor) || /Призрак:\s*Забвение/i.test(rootText) || isWraithRoll;
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

function isArcanosRoll(root) {
  // Attribute/Ability rolls also contain the Willpower checkbox. Arcanos item
  // dialogs are distinguished by the two rules sections shown by WoD20.
  const hasDescription = hasSectionHeading(root, /^(описание|description)$/i);
  const hasSystem = hasSectionHeading(root, /^(система|system)$/i);
  return hasDescription && hasSystem;
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

function insertControls(root, willpower, actor, current) {
  const row = document.createElement("div");
  row.className = "wraith-pathos-spend";
  row.innerHTML = `
    <div class="wraith-pathos-check" data-pathos-use role="checkbox" aria-checked="false" tabindex="0">
      <span class="wraith-pathos-box" aria-hidden="true"></span>
      <span>Использовать Пафос</span>
    </div>
    <label class="wraith-pathos-cost">
      <span>Стоимость</span>
      <input type="number" data-pathos-cost value="1" min="1" max="${Math.max(1, current)}" step="1">
    </label>
    <span class="wraith-pathos-current" title="Текущий запас Пафоса">Доступно: ${current}</span>
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
  checkbox.checked = false;

  const setChecked = checked => {
    checkbox.checked = Boolean(checked);
    checkbox.setAttribute("aria-checked", String(checkbox.checked));
    row.classList.toggle("is-active", checkbox.checked);
  };

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

  correctWraithLabels(app, root);
  if (root.dataset.wraithPathosReady === "true") return;

  // Never add Pathos spending to ordinary Attribute or Ability rolls.
  if (!isArcanosRoll(root)) return;

  const willpower = willpowerCheckbox(root);
  const button = rollButton(root);
  const actor = actorFrom(app);
  const resource = actor && pathosData(actor);
  if (!willpower || !button || !actor || !resource) return;

  const { row, checkbox, cost } = insertControls(root, willpower, actor, resource.value);

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
      await actor.update({ [live.path]: live.value - amount });
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
