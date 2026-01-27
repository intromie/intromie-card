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
const lockBtn     = document.getElementById("lockBtn");
const toast       = document.getElementById("toast");

const frontImg    = document.getElementById("frontImg");
const backImg     = document.getElementById("backImg");
const uploadF     = document.getElementById("uploadFrontTap");
const uploadB     = document.getElementById("uploadBackTap");
const frontFace   = document.getElementById("frontFace");
const backFace    = document.getElementById("backFace");
const filePick    = document.getElementById("filePick");
const lockOverlay = document.getElementById("lockOverlay");

/* Hint overlay */
const hintFront = document.getElementById("hintFront");
const hintBack  = document.getElementById("hintBack");

/* Palette */
const paletteWrap = document.getElementById("paletteWrap");
const paletteEl   = document.getElementById("palette");

/* PIN Modal */
const pinModal = document.getElementById("pinModal");
const pinTitle = document.getElementById("pinTitle");
const pinDots  = document.getElementById("pinDots");
const pinPad   = document.getElementById("pinPad");
const dotEls   = Array.from(pinDots.querySelectorAll(".dot"));

/* Security Modal */
const secModal  = document.getElementById("secModal");
const secCheck  = document.getElementById("secCheck");
const secAccept = document.getElementById("secAccept");
const secCancel = document.getElementById("secCancel");

/* Edit PIN Info Modal */
const editInfoModal    = document.getElementById("editInfoModal");
const editInfoCancel   = document.getElementById("editInfoCancel");
const editInfoContinue = document.getElementById("editInfoContinue");

/* Lock Info Modal */
const lockInfoModal    = document.getElementById("lockInfoModal");
const lockInfoCancel   = document.getElementById("lockInfoCancel");
const lockInfoContinue = document.getElementById("lockInfoContinue");
const removePhotoBtn = document.getElementById("removePhotoBtn");

let stagedRemovePhoto = false;


/* =========================
   State
   ========================= */
let editing = false;
let busy = false;
let viewLocked = false;
let pinModalOpen = false;
let saving = false;

let securityAccepted = false;
let pickTarget = "front";

let cardId = "";
let docRef = null;

// remote data
let remotePinHash = ""; // EDIT PIN
let remoteFrontUrl = "";
let remoteBackUrl = "";

// background color
let remoteBgColor = "";
let stagedBgColor = "";

// lock card data
let cardLocked = false;
let lockPinHash = "";
let unlockedThisSession = false;

// local staged images until SAVE
let stagedFrontDataUrl = "";
let stagedBackDataUrl = "";

/* Pastel set */
const PASTELS = [
  "#a48bc1", // blush pink
  "#a5ddf8", // peach
  "#28b570", // butter
  "#fab52a", // mint
  "#f16a90", // baby blue
  "#e14d4e", // lavender
  "#F3E6FF", // lilac
  "#8f8f8f"  // gray
];

/* =========================
   Helpers
   ========================= */
function isLightColor(hex){
  if(!hex) return false;
  const c = hex.replace("#","");

  const r = parseInt(c.substring(0,2),16);
  const g = parseInt(c.substring(2,4),16);
  const b = parseInt(c.substring(4,6),16);

  // luminance (มาตรฐาน)
  const luminance = (0.299*r + 0.587*g + 0.114*b);
  return luminance > 180;
}


function getCardId(){
  const u = new URL(location.href);
  return (u.searchParams.get("id") || "").trim();
}

function side(){
  return card.classList.contains("isFlipped") ? "back" : "front";
}

function uv(face){
  face.classList.remove("uvRun");
  void face.offsetWidth;
  face.classList.add("uvRun");
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function showToast(msg){
  if(!toast) return;
  toast.textContent = msg;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0px)";
  await sleep(1300);
  toast.style.opacity = "0";
  toast.style.transform = "translateX(-50%) translateY(-8px)";
}

async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

/* =========================
   Background color
   ========================= */
function applyBgColor(color){
  const bg = color || "#8f8f8f";
  document.body.style.background = bg;

  const light = isLightColor(bg);

  // ===== EDIT BUTTON =====
  editBtn.style.color = light ? "#222" : "#f2f2f2";
  editBtn.style.opacity = "0.85";

  // ===== LOCK BUTTON =====
  lockBtn.style.color = light ? "#222" : "#f2f2f2";
  lockBtn.style.opacity = "0.85";
}



function updatePaletteActive(){
  if(!paletteEl) return;
  const current = (stagedBgColor || remoteBgColor || "").toLowerCase();
  [...paletteEl.children].forEach((btn) => {
    const bg = (btn.style.background || "").toLowerCase();
    btn.classList.toggle("isOn", bg === current);
  });
}

function updatePaletteVisible(){
  if(!paletteWrap) return;
  const show = !viewLocked && editing;
  paletteWrap.style.display = show ? "flex" : "none";
  paletteWrap.setAttribute("aria-hidden", show ? "false" : "true");
}

function renderPalette(){
  if(!paletteEl) return;
  paletteEl.innerHTML = "";
  PASTELS.forEach((hex) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.setAttribute("aria-label", `Set background ${hex}`);

    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if(viewLocked || saving || pinModalOpen || !editing) return;

      stagedBgColor = hex;
      applyBgColor(stagedBgColor || remoteBgColor);
      updatePaletteActive();
      updateLockButton(); // ✅ เลือกสีแล้ว = unsaved change -> lock disabled
    });

    paletteEl.appendChild(b);
  });

  updatePaletteActive();
}

/* =========================
   Upload hint overlay
   ========================= */
function updateUploadHints(){
  const frontShow = !!remoteFrontUrl && !stagedFrontDataUrl;
  const backShow  = !!remoteBackUrl  && !stagedBackDataUrl;

  uploadF.classList.toggle("showHint", !viewLocked && !saving && editing && frontShow && side()==="front");
  uploadB.classList.toggle("showHint", !viewLocked && !saving && editing && backShow  && side()==="back");

  if(hintFront) hintFront.innerHTML = "UPLOAD<br>NEW PHOTO";
  if(hintBack)  hintBack.innerHTML  = "UPLOAD<br>NEW PHOTO";
}

/* =========================
   Lock Button visibility
   ========================= */
function updateLockButton(){
  // lock overlay -> hide buttons
  if(viewLocked){
    lockBtn.style.visibility = "hidden";
    return;
  }

  if(!editing){
    lockBtn.style.visibility = "hidden";
    return;
  }

  // ✅ unsaved changes include bgColor too
  const hasUnsavedChanges = !!stagedFrontDataUrl || !!stagedBackDataUrl || !!stagedBgColor;

  lockBtn.style.visibility = "visible";
  lockBtn.textContent = cardLocked ? "UNLOCK CARD" : "LOCK CARD";

  lockBtn.disabled = saving || pinModalOpen || hasUnsavedChanges;
  lockBtn.style.opacity = lockBtn.disabled ? "0.45" : "";
}

/* =========================
   Edit mode
   ========================= */
function setEdit(on){
  editing = on;
  editBtn.textContent = on ? "SAVE" : "EDIT";
  uploadF.classList.toggle("isOn", on && side() === "front");
  uploadB.classList.toggle("isOn", on && side() === "back");
  updateUploadHints();
  updateLockButton();

  updatePaletteVisible();
  updatePaletteActive();
}

/* =========================
   View lock overlay
   ========================= */
function setViewLocked(on){
  viewLocked = on;
  lockOverlay.classList.toggle("isOn", on);

  // ✅ ตอน lock overlay ซ่อนปุ่ม EDIT/LOCK
  editBtn.style.visibility = on ? "hidden" : "visible";
  lockBtn.style.visibility = "hidden";

  if(on && editing) setEdit(false);
  updateUploadHints();
  updatePaletteVisible();
  updateLockButton();
}

function setSaving(on){
  saving = on;
  if(on){
    editBtn.textContent = "SAVING…";
    editBtn.disabled = true;
    editBtn.style.opacity = "0.65";
    editBtn.style.pointerEvents = "none";
  }else{
    editBtn.disabled = false;
    editBtn.style.opacity = "";
    editBtn.style.pointerEvents = "";
  }
  updateUploadHints();
  updatePaletteVisible();
  updateLockButton();
}

async function flashSaved(){
  editBtn.textContent = "✓ SAVED";
  uv(side() === "front" ? frontFace : backFace);
  await sleep(450);
}

/* =========================
   Modals
   ========================= */
function openEditInfoModal(){
  return new Promise((resolve) => {
    editInfoModal.classList.add("isOn");
    editInfoModal.setAttribute("aria-hidden", "false");

    const close = (ok) => {
      editInfoModal.classList.remove("isOn");
      editInfoModal.setAttribute("aria-hidden", "true");
      editInfoCancel.removeEventListener("click", onCancel);
      editInfoContinue.removeEventListener("click", onContinue);
      resolve(ok);
    };

    const onCancel = () => close(false);
    const onContinue = () => close(true);

    editInfoCancel.addEventListener("click", onCancel);
    editInfoContinue.addEventListener("click", onContinue);
  });
}

function openLockInfoModal(){
  return new Promise((resolve) => {
    lockInfoModal.classList.add("isOn");
    lockInfoModal.setAttribute("aria-hidden", "false");

    const close = (ok) => {
      lockInfoModal.classList.remove("isOn");
      lockInfoModal.setAttribute("aria-hidden", "true");
      lockInfoCancel.removeEventListener("click", onCancel);
      lockInfoContinue.removeEventListener("click", onContinue);
      resolve(ok);
    };

    const onCancel = () => close(false);
    const onContinue = () => close(true);

    lockInfoCancel.addEventListener("click", onCancel);
    lockInfoContinue.addEventListener("click", onContinue);
  });
}

/* =========================
   PIN modal flows
   ========================= */
function updateDots(n){ dotEls.forEach((d,i)=> d.classList.toggle("filled", i < n)); }
function shakeDots(){
  pinDots.classList.remove("shake");
  void pinDots.offsetWidth;
  pinDots.classList.add("shake");
}

function openPinModalFlow(flow){
  return new Promise((resolve) => {
    let step =
      (flow === "set") ? "set1" :
      (flow === "enter") ? "enter" :
      (flow === "setLock") ? "lock1" :
      (flow === "enterLock") ? "enterLock" :
      "enter";

    let firstPin = "";
    let input = "";

    pinModalOpen = true;
    pinModal.classList.add("isOn");
    pinModal.setAttribute("aria-hidden", "false");
    updateLockButton();

    const setTitle = () => {
      if (step === "enter")     pinTitle.textContent = "Enter PIN";
      if (step === "set1")      pinTitle.textContent = "Set PIN";
      if (step === "set2")      pinTitle.textContent = "Confirm PIN";

      if (step === "enterLock") pinTitle.textContent = "Unlock Card PIN";
      if (step === "lock1")     pinTitle.textContent = "Set Lock PIN";
      if (step === "lock2")     pinTitle.textContent = "Confirm Lock PIN";
    };

    const resetInput = () => { input = ""; updateDots(0); };

    const close = (ok) => {
      pinModalOpen = false;
      pinModal.classList.remove("isOn");
      pinModal.setAttribute("aria-hidden", "true");
      pinPad.removeEventListener("click", onPadClick);
      updateLockButton();
      resolve(ok);
    };

    const wrong = () => { shakeDots(); resetInput(); };

    const accept4 = async () => {
      // ENTER EDIT PIN
      if(step === "enter"){
        const h = await sha256(input);
        if(h === remotePinHash) return close(true);
        return wrong();
      }

      // SET EDIT PIN
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
        const h = await sha256(input);
        await docRef.set({
          pinHash: h,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        remotePinHash = h;
        return close(true);
      }

      // ENTER LOCK PIN
      if(step === "enterLock"){
        const h = await sha256(input);
        if(h === lockPinHash) return close(true);
        return wrong();
      }

      // SET LOCK PIN
      if(step === "lock1"){
        firstPin = input;
        step = "lock2";
        setTitle();
        resetInput();
        return;
      }
      if(step === "lock2"){
        if(input !== firstPin){
          wrong();
          step = "lock1";
          setTitle();
          firstPin = "";
          return;
        }
        const h = await sha256(input);
        await docRef.set({
          isLocked: true,
          lockPinHash: h,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        lockPinHash = h;
        cardLocked = true;
        unlockedThisSession = false;

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

async function authEdit(){
  if(!remotePinHash){
    const ok = await openEditInfoModal();
    if(!ok) return false;
    return await openPinModalFlow("set");
  }
  return await openPinModalFlow("enter");
}

/* =========================
   Security modal
   ========================= */
function openSecurityModal(){
  return new Promise((resolve) => {
    secModal.classList.add("isOn");
    secModal.setAttribute("aria-hidden", "false");
    secCheck.checked = false;
    secAccept.style.opacity = "0.5";
    secAccept.style.pointerEvents = "none";

    const close = (ok) => {
      secModal.classList.remove("isOn");
      secModal.setAttribute("aria-hidden", "true");
      secCheck.removeEventListener("change", onCheck);
      secAccept.removeEventListener("click", onAccept);
      secCancel.removeEventListener("click", onCancel);
      resolve(ok);
    };

    const onCheck = () => {
      if(secCheck.checked){
        secAccept.style.opacity = "1";
        secAccept.style.pointerEvents = "auto";
      }else{
        secAccept.style.opacity = "0.5";
        secAccept.style.pointerEvents = "none";
      }
    };

    const onAccept = () => close(true);
    const onCancel = () => close(false);

    secCheck.addEventListener("change", onCheck);
    secAccept.addEventListener("click", onAccept);
    secCancel.addEventListener("click", onCancel);
  });
}

/* =========================
   Firebase load / render
   ========================= */
function renderImages(){
  frontImg.src = remoteFrontUrl || "./assets/blank_front.png";
  backImg.src  = remoteBackUrl  || "./assets/blank_back.png";

  uploadF.classList.toggle("hasPhoto", !!remoteFrontUrl);
  uploadB.classList.toggle("hasPhoto", !!remoteBackUrl);

  applyBgColor(remoteBgColor);
  updatePaletteActive();
  updateUploadHints();
}

async function loadCard(){
  const snap = await docRef.get();

  if(!snap.exists){
    remotePinHash = "";
    remoteFrontUrl = "";
    remoteBackUrl = "";

    remoteBgColor = "";
    stagedBgColor = "";

    cardLocked = false;
    lockPinHash = "";
    unlockedThisSession = false;

    renderImages();
    setViewLocked(false);
    updateLockButton();
    return;
  }

  const data = snap.data() || {};
  remotePinHash  = data.pinHash || "";
  remoteFrontUrl = data.frontUrl || "";
  remoteBackUrl  = data.backUrl || "";

  remoteBgColor  = data.bgColor || "";
  stagedBgColor  = "";

  cardLocked = !!data.isLocked;
  lockPinHash = data.lockPinHash || "";
  unlockedThisSession = false;

  renderImages();
  setViewLocked(cardLocked);
  updateLockButton();
}

/* =========================
   Upload & Save
   ========================= */
function pick(){
  filePick.value = "";
  filePick.click();
}

async function requestUpload(which){
  if(viewLocked || pinModalOpen || saving) return;
  if(!editing) return;

  pickTarget = which;

  if(!securityAccepted){
    const ok = await openSecurityModal();
    if(!ok) return;
    securityAccepted = true;
  }

function updateRemovePhotoBtn(){
  if(
    isEditMode &&
    !isCardLocked &&
    currentPhotoUrl &&       // มีรูปอยู่
    !stagedRemovePhoto       // ยังไม่ได้ลบ
  ){
    removePhotoBtn.style.display = "flex";
  }else{
    removePhotoBtn.style.display = "none";
  }
}
if(stagedRemovePhoto){
  cardData.photoUrl = null;
  stagedRemovePhoto = false;
}


  pick();
}

uploadF.onclick = (e) => { e.stopPropagation(); if(side()==="front") requestUpload("front"); };
uploadB.onclick = (e) => { e.stopPropagation(); if(side()==="back")  requestUpload("back"); };

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

  if(pickTarget === "front"){
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

  updateUploadHints();
  updateLockButton();
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

  if(stagedBgColor && stagedBgColor !== remoteBgColor){
    updates.bgColor = stagedBgColor;
    remoteBgColor = stagedBgColor;
    stagedBgColor = "";
    did = true;
  }

  if(did){
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.set(updates, { merge: true });
  }

  applyBgColor(remoteBgColor);
  updatePaletteActive();
  updateUploadHints();
  updateLockButton();
}

/* =========================
   UI interactions
   ========================= */
editBtn.onclick = async (e) => {
  e.stopPropagation();
  if (pinModalOpen || saving) return;

  if(!editing){
    const ok = await authEdit();
    if(ok){
      setEdit(true);
      uv(side() === "front" ? frontFace : backFace);
    }
  }else{
    try{
      setSaving(true);
      await saveIfNeeded();
      await flashSaved();
      setEdit(false);
      uv(side() === "front" ? frontFace : backFace);
      showToast("✓ SAVED");
    }finally{
      setSaving(false);
    }
  }
};

lockBtn.onclick = async (e) => {
  e.stopPropagation();
  if (pinModalOpen || saving) return;
  if(!editing) return;

  // extra safety
  if(!!stagedFrontDataUrl || !!stagedBackDataUrl || !!stagedBgColor) return;

  if(!cardLocked){
    const understood = await openLockInfoModal();
    if(!understood) return;

    const ok = await openPinModalFlow("setLock");
    if(ok){
      cardLocked = true;
      unlockedThisSession = false;
      setViewLocked(true);
      updateLockButton();
      uv(side() === "front" ? frontFace : backFace);
      showToast("✓ LOCKED");
    }
  }else{
    const ok = await openPinModalFlow("enterLock");
    if(!ok) return;

    await docRef.set({
      isLocked: false,
      lockPinHash: "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    cardLocked = false;
    lockPinHash = "";
    unlockedThisSession = false;
    setViewLocked(false);
    updateLockButton();
    uv(side() === "front" ? frontFace : backFace);
    showToast("✓ UNLOCKED");
  }
};

lockOverlay.onclick = async (e) => {
  e.stopPropagation();
  if (pinModalOpen || saving) return;

  if(!cardLocked){
    setViewLocked(false);
    updateLockButton();
    return;
  }

  const ok = await openPinModalFlow("enterLock");
  if(ok){
    unlockedThisSession = true;
    setViewLocked(false);
    updateLockButton();
    uv(side() === "front" ? frontFace : backFace);
  }
};

card.onclick = () => {
  if(viewLocked || pinModalOpen || saving) return;
  if(editing || busy) return;
  busy = true;
  card.classList.toggle("isFlipped");
};

card.addEventListener("transitionend", () => {
  if (viewLocked) { busy = false; return; }
  uv(side() === "front" ? frontFace : backFace);
  if(editing) setEdit(true);
  busy = false;
  updateUploadHints();
  updateLockButton();
});
removePhotoBtn.addEventListener("click",()=>{
  openConfirmModal({
    title:"Remove Photo",
    message:`
This will remove the current image from this card.
You can upload a new image afterward.

This action will only be saved when you press SAVE.
    `,
    confirmText:"REMOVE",
    cancelText:"CANCEL",
    onConfirm:()=>{
      stagedRemovePhoto = true;

      // ล้าง preview รูป
      clearPhotoPreview();   // ใช้ฟังก์ชันเดิมที่กลับไปหน้า UPLOAD PHOTO
      currentPhotoUrl = null;

      updateRemovePhotoBtn();
    }
  });
});

/* =========================
   Boot
   ========================= */
(async function boot(){
  cardId = getCardId();
  if(!cardId){
    alert("Missing card id. Add ?id=ABC000001 to the URL");
    editBtn.style.visibility = "hidden";
    lockBtn.style.visibility = "hidden";
    setViewLocked(true);
    return;
  }

  docRef = db.collection("cards").doc(cardId);

  renderPalette();          // ✅ create palette once
  updatePaletteVisible();   // ✅ hidden until EDIT

  await loadCard();
  updateUploadHints();
  updateLockButton();
})();
