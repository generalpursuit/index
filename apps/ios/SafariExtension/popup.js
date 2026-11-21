const address = document.querySelector("#address");
const picker = document.querySelector("#picker");
const destination = document.querySelector("#destination");
const statusText = document.querySelector("#status");
const action = document.querySelector("#action");

let pageURL;
let identity;
let pending;

function showAction(label, handler) {
  action.textContent = label;
  action.hidden = false;
  action.disabled = false;
  action.onclick = handler;
}

function send(message) {
  return browser.runtime.sendNativeMessage("com.generalpursuit.index", message);
}

async function loadDestinations(requireChoice = false) {
  picker.hidden = true;
  destination.replaceChildren();
  action.hidden = true;
  identity = undefined;
  pending = undefined;
  statusText.textContent = "Loading destinations…";
  try {
    const reply = await send({ action: "destinations" });
    if (reply.error) throw new Error(reply.error);
    identity = { account: reply.account, session: reply.session };
    destination.add(new Option("Your links", ""));
    for (const group of reply.groups) destination.add(new Option(group.name, group.id));
    if (requireChoice) destination.selectedIndex = -1;
    destination.disabled = false;
    picker.hidden = false;
    statusText.textContent = "";
    showAction("Save", () => save(false));
    action.disabled = requireChoice;
    destination.onchange = () => { action.disabled = false; };
  } catch (error) {
    statusText.textContent = error.message || "Couldn’t load destinations.";
    showAction("Retry", () => loadDestinations(requireChoice));
  }
}

async function save(again) {
  action.disabled = true;
  destination.disabled = true;
  statusText.textContent = "Saving…";
  // A lost reply can follow a committed save. Retry the exact message while the popup is open.
  pending ??= { ...identity, action: "save", url: pageURL, groupID: destination.value,
    requestID: crypto.randomUUID(), saveAgain: String(again) };
  try {
    const reply = await send(pending);
    if (reply.reset || reply.chooseAgain) {
      identity = undefined;
      pending = undefined;
      destination.replaceChildren();
      picker.hidden = true;
      statusText.textContent = reply.error;
      showAction(reply.reset ? "Reload" : "Choose destination", () => loadDestinations(true));
      return;
    }
    if (reply.error) throw new Error(reply.error);
    if (reply.status === "existing") {
      pending = undefined;
      statusText.textContent = "Already in Index. Save again to add another copy.";
      showAction("Save again", () => save(true));
    } else if (reply.status === "saved") {
      statusText.textContent = "Saved to " + destination.selectedOptions[0].text + ".";
      picker.hidden = true;
      showAction("Done", () => window.close());
    } else {
      throw new Error("Couldn’t confirm the save.");
    }
  } catch (error) {
    statusText.textContent = error.message || "Couldn’t confirm the save.";
    showAction("Retry save", () => save(again));
  }
}

async function openPopup() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    pageURL = tab.url;
    address.textContent = pageURL;
  } catch {
    statusText.textContent = "Open an HTTP or HTTPS page and allow Index access to this tab.";
    return;
  }
  await loadDestinations();
}

openPopup();
