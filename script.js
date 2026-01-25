/* =========================
   Firebase refs
   ========================= */
const db = firebase.firestore();
const st = firebase.storage();

/* =========================
   DOM
   ========================= */
const card        = document.getElementById("card3d");
const editBtn     = document.getElementById("editBtn");
const frontImg    = document.getElementById("frontImg");
const backImg     = document.getElementById("backImg");
const uploadF     = document.getElementById("uploadFrontTap");
const uploadB     = document.getElementById("uploadBackTap");
const frontFace   = document.getElementById("frontFace");
const backFace    = document.getElementById("backFace");
const filePick    = document.getElementById("filePick");
const lockOverlay = document.getElementById("lockOverlay");

/* PIN Modal */
const pinModal = document.getElementById("pinModal");
const pinTitle = document.getElementById("pinTitle");
const pinDots  = document.getElementById("pinDots");
const pinPad   = document.getElementById("pinPad");
const dotEls   = Array.from(pinDots.querySelectorAll(".dot"));

/* =========================
   State
   ========================= */
let editing = false;
let busy = false;
let locked = false;
let pinModalOpen = false;

let cardId = "";
let docRef = null;

// remote data
let remotePinHash = "";
let remoteFrontUrl = "";
let remoteBackUrl = "";

// local staged images (dataURL) until SAVE
let stagedFrontDataUrl = "";
let stagedBackDataUrl = "";

/* =========================
   Helpers
   ========================= */
function getCardId(){
  const u = new URL(location.href);
  const id = (u.searchParams.get("id") || "").trim();
  return id;
}

function side(){
  return card.classList.contains("isFlipped") ? "back" : "front";
}

function uv(face){
  face.classList.remove("uvRun");
  void face.offsetWidth;
  face.classList.add("uvRun");
}

function setLocked(on){
  locked = on;
  lockOverlay.classList.toggle("isOn", on);
  editBtn.style.visibility = on ? "hidden" : "visible";
  if (on && editing) setEdit(false);
}

function setEdit(on){
  editing = on;
  editBtn.textContent = on ? "SAVE" : "EDIT";
  uploadF.classList.toggle("isOn", on && side() === "front");
  uploadB.classList.toggle("isOn", on && side() === "back");
}

async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

/* =========================
   PIN modal
   ========================= */
function updateDots(n){ dotEls.forEach((d,i)=> d.classList.toggle("filled", i < n)); }
function shakeDots(){
  pinDots.classList.remove("shake");
  void pinDots.offsetWidth;
  pinDots.classList.add("shake");
}

function openPinModalFlow(flow){
  // flow: "enter" | "set"
  return new Promise((resolve) => {
    let step = (flow === "set") ? "set1" : "enter";
    let firstPin = "";
    let input = "";

    pinModalOpen = true;
    pinModal.classList.add("isOn");
    pinModal.setAttribute("aria-hidden", "false");

    const setTitle = () => {
      if (step === "enter") pinTitle.textContent = "Enter PIN";
      if (step === "set1")  pinTitle.textContent = "Set PIN";
      if (step === "set2")  pinTitle.textContent = "Confirm PIN";
    };

    const resetInput = () => { input = ""; updateDots(0); };

    const close = (ok) => {
      pinModalOpen = false;
      pinModal.classList.remove("isOn");
      pinModal.setAttribute("aria-hidden", "true");
      pinPad.removeEventListener("click", onPadClick);
      resolve(ok);
    };

    const wrong = () => { shakeDots(); resetInput(); };

    const accept4 = async () => {
      if(step === "enter"){
        const h = await sha256(input);
        if(h === remotePinHash) return close(true);
        return wrong();
      }

      if(step === "set1"){
        firstPin = input;
        step = "set2";
        setTitle();
        resetInput();
        return;
      }

      if(step === "set2"){
        if(input !== firstPin){
          wrong();
          step = "set1";
          setTitle();
          firstPin = "";
          return;
        }
        // save pin to Firestore
        const h = await sha256(input);
        await docRef.set({
          pinHash: h,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        remotePinHash = h;
        return close(true);
      }
    };

    function onPadClick(e){
      const btn = e.target.closest("button");
      if(!btn) return;

      const digit = btn.getAttribute("data-digit");
      const action = btn.getAttribute("data-action");

      if(action === "cancel") return close(false);

      if(action === "back"){
        if(input.length > 0){
          input = input.slice(0,-1);
          updateDots(input.length);
        }
        return;
      }

      if(digit !== null){
        if(input.length >= 4) return;
        input += digit;
        updateDots(input.length);
        if(input.length === 4) setTimeout(accept4, 60);
      }
    }

    setTitle();
    resetInput();
    pinPad.addEventListener("click", onPadClick);
  });
}

async function auth(){
  if(!remotePinHash){
    // first time: set + confirm
    return await openPinModalFlow("set");
  }
  return await openPinModalFlow("enter");
}

/* =========================
   Firebase load / render
   ========================= */
function renderImages(){
  frontImg.src = remoteFrontUrl || "./assets/blank_front.png";
  backImg.src  = remoteBackUrl  || "./assets/blank_back.png";

  uploadF.classList.toggle("hasPhoto", !!remoteFrontUrl);
  uploadB.classList.toggle("hasPhoto", !!remoteBackUrl);
}

async function loadCard(){
  const snap = await docRef.get();

  if(!snap.exists){
    // new card
    remotePinHash = "";
    remoteFrontUrl = "";
    remoteBackUrl = "";
    renderImages();
    setLocked(false); // first time not locked
    return;
  }

  const data = snap.data() || {};
  remotePinHash = data.pinHash || "";
  remoteFrontUrl = data.frontUrl || "";
  remoteBackUrl  = data.backUrl || "";

  renderImages();

  // if already has pin -> lock on open
  setLocked(!!remotePinHash);
}

/* =========================
   Upload & Save
   ========================= */
function pick(){
  filePick.value = "";
  filePick.click();
}

uploadF.onclick = (e) => { e.stopPropagation(); if(!locked && !pinModalOpen && editing && side()==="front") pick(); };
uploadB.onclick = (e) => { e.stopPropagation(); if(!locked && !pinModalOpen && editing && side()==="back")  pick(); };

filePick.onchange = async () => {
  const f = filePick.files && filePick.files[0];
  if(!f) return;

  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode();

  const maxW = 1200;
  const s = Math.min(1, maxW / img.width);

  const c = document.createElement("canvas");
  c.width  = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);

  URL.revokeObjectURL(img.src);

  const dataUrl = c.toDataURL("image/webp", 0.85);

  if(side() === "front"){
    frontImg.src = dataUrl;
    stagedFrontDataUrl = dataUrl;
    uploadF.classList.add("hasPhoto");
    uv(frontFace);
  }else{
    backImg.src = dataUrl;
    stagedBackDataUrl = dataUrl;
    uploadB.classList.add("hasPhoto");
    uv(backFace);
  }
};

async function uploadDataUrlToStorage(path, dataUrl){
  const ref = st.ref().child(path);
  await ref.putString(dataUrl, "data_url", { contentType: "image/webp" });
  return await ref.getDownloadURL();
}

async function saveIfNeeded(){
  const updates = {};
  let did = false;

  if(stagedFrontDataUrl){
    const url = await uploadDataUrlToStorage(`cards/${cardId}/front.webp`, stagedFrontDataUrl);
    updates.frontUrl = url;
    remoteFrontUrl = url;
    stagedFrontDataUrl = "";
    did = true;
  }

  if(stagedBackDataUrl){
    const url = await uploadDataUrlToStorage(`cards/${cardId}/back.webp`, stagedBackDataUrl);
    updates.backUrl = url;
    remoteBackUrl = url;
    stagedBackDataUrl = "";
    did = true;
  }

  if(did){
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.set(updates, { merge: true });
  }
}

/* =========================
   UI interactions
   ========================= */
editBtn.onclick = async (e) => {
  e.stopPropagation();
  if (locked || pinModalOpen) return;

  if(!editing){
    const ok = await auth(); // enter or set
    if(ok){
      setEdit(true);
      uv(side() === "front" ? frontFace : backFace);
    }
  }else{
    // SAVE
    await saveIfNeeded();
    setEdit(false);
    uv(side() === "front" ? frontFace : backFace);
  }
};

// Tap lock screen to unlock
lockOverlay.onclick = async (e) => {
  e.stopPropagation();
  if (pinModalOpen) return;

  const ok = await openPinModalFlow("enter");
  if (ok) {
    setLocked(false);
    uv(side() === "front" ? frontFace : backFace);
  }
};

// Flip
card.onclick = () => {
  if(locked || pinModalOpen) return;
  if(editing || busy) return;
  busy = true;
  card.classList.toggle("isFlipped");
};

card.addEventListener("transitionend", () => {
  if (locked) { busy = false; return; }
  uv(side() === "front" ? frontFace : backFace);
  if(editing) setEdit(true);
  busy = false;
});

/* =========================
   Boot
   ========================= */
(async function boot(){
  cardId = getCardId();
  if(!cardId){
    alert("Missing card id. Add ?id=ABC000001 to the URL");
    // keep blank, disable everything
    editBtn.style.visibility = "hidden";
    setLocked(true);
    return;
  }

  docRef = db.collection("cards").doc(cardId);
  await loadCard();
})();
