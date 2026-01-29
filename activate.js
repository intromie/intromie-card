// activate.js (type="module")
// Gate หน้าบ้าน: ต้องใส่ Activate PIN 6 หลัก ครั้งแรกเท่านั้น ต่อ cardId
// - PIN: 253829 (แก้ได้ที่ ACTIVATE_PIN)
// - ผิดได้ 3 ครั้ง -> ล็อกถาวร (ต่อ cardId) โดยบันทึกลง Firestore
// - ถ้าผ่านแล้ว จะ set activated=true แล้วเข้าระบบเดิมตามปกติ
// NOTE: โค้ดนี้ไม่ไปยุ่งกับโค้ดเดิม แค่ทำ overlay ครอบไว้ก่อน

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ========= CONFIG =========
const ACTIVATE_PIN = "253829";        // 6 digits
const MAX_TRIES = 3;

// TODO: ใส่ firebaseConfig ของพี่ตรงนี้ (ก๊อปจากหน้า Firebase Web App config)
const firebaseConfig = {
  apiKey: "AIzaSyBlKxcRC4cpTCmfRfK1-ONRc60lzNsbDZs",
  authDomain: "intromie-web-card.firebaseapp.com",
  projectId: "intromie-web-card",
  storageBucket: "intromie-web-card.firebasestorage.app",
  messagingSenderId: "834328323445",
  appId: "1:834328323445:web:d3afb22df2dba035a3df3c"
};

// ========= Helpers =========
function getCardId() {
  const url = new URL(window.location.href);
  const id = url.searchParams.get("id") || "";
  return id.trim();
}

function isValidCardId(cardId) {
  // FORMAT: PREFIX-BATCH-RAND7
  // PREFIX: A-Z 2–10 ตัว
  // BATCH: YY(2 digits) + MonthCode(A-L) + round(1–4 digits)
  // RAND7: ตัวเลข 7 หลัก
  return /^[A-Z]{2,10}-[0-9]{2}[A-L][0-9]{1,4}-[0-9]{7}$/.test(cardId);
}


function injectStyles() {
  if (document.getElementById("activate-style")) return;
  const css = `
  .actv-overlay{
    position:fixed; inset:0; z-index:999999;
    display:flex; align-items:center; justify-content:center;
    background: rgba(0,0,0,.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    padding: 18px;
  }
  .actv-card{
    width:min(92vw,420px);
    background:#fff;
    border-radius:18px;
    padding:18px 16px 16px;
    box-shadow: 0 18px 55px rgba(0,0,0,.25);
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }
  .actv-title{
    font-size:16px; font-weight:700; color:#111; margin:0 0 6px;
    letter-spacing:.2px;
  }
  .actv-sub{
    font-size:13px; color:#444; margin:0 0 14px; line-height:1.45;
  }
  .actv-row{
    display:flex; gap:10px; justify-content:center; margin: 10px 0 12px;
  }
  .actv-dot{
    width:14px; height:14px; border-radius:999px;
    background:#e7e7e7;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.06);
  }
  .actv-dot.filled{ background:#111; }
  .actv-msg{
    min-height: 18px;
    text-align:center;
    font-size:12px;
    color:#b00020;
    margin: 6px 0 10px;
  }
  .actv-pad{
    display:grid;
    grid-template-columns: repeat(3, 1fr);
    gap:10px;
    user-select:none;
  }
  .actv-btn{
    height:54px;
    border:none;
    border-radius:14px;
    background:#f2f2f2;
    font-size:18px;
    font-weight:700;
    color:#111;
    cursor:pointer;
    transition: transform .06s ease, background .12s ease;
  }
  .actv-btn:active{ transform: scale(.98); background:#e9e9e9; }
  .actv-btn.secondary{
    font-size:14px; font-weight:700;
  }
  .actv-foot{
    display:flex; justify-content:space-between; align-items:center;
    margin-top:12px; gap:10px;
  }
  .actv-tries{
    font-size:12px; color:#666;
  }
  .actv-lock{
    text-align:center; padding: 6px 0 0;
    font-size:12px; color:#111;
  }
  .actv-shake{
    animation: actvShake .22s ease-in-out 0s 2;
  }
  @keyframes actvShake{
    0%{ transform: translateX(0); }
    25%{ transform: translateX(-6px); }
    50%{ transform: translateX(6px); }
    75%{ transform: translateX(-4px); }
    100%{ transform: translateX(0); }
  }
  `;
  const style = document.createElement("style");
  style.id = "activate-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function buildOverlay() {
  injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "actv-overlay";
  overlay.id = "activateOverlay";

  overlay.innerHTML = `
    <div class="actv-card" id="actvCard">
      <p class="actv-title">Activate PIN</p>
      <p class="actv-sub">Enter the 6-digit activation code to enable this card.</p>

      <div class="actv-row" id="actvDots">
        ${Array.from({length:6}).map(()=>`<div class="actv-dot"></div>`).join("")}
      </div>

      <div class="actv-msg" id="actvMsg"></div>

      <div class="actv-pad" id="actvPad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="actv-btn" data-n="${n}">${n}</button>`).join("")}
        <button class="actv-btn secondary" id="actvClear">CLEAR</button>
        <button class="actv-btn" data-n="0">0</button>
        <button class="actv-btn secondary" id="actvBack">⌫</button>
      </div>

      <div class="actv-foot">
        <div class="actv-tries" id="actvTries">Attempts: -</div>
        <div class="actv-tries" id="actvCardId"></div>
      </div>

      <div class="actv-lock" id="actvLockNote" style="display:none;">
        This card has been permanently locked due to too many failed attempts.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  return overlay;
}

function setDots(val) {
  const dots = document.querySelectorAll("#actvDots .actv-dot");
  dots.forEach((d,i)=> d.classList.toggle("filled", i < val.length));
}

function setMsg(text) {
  const el = document.getElementById("actvMsg");
  if (el) el.textContent = text || "";
}

function setTries(n) {
  const el = document.getElementById("actvTries");
  if (el) el.textContent = `Attempts: ${n}/${MAX_TRIES}`;
}

function setLockedUI(locked) {
  const note = document.getElementById("actvLockNote");
  const pad  = document.getElementById("actvPad");
  if (note) note.style.display = locked ? "block" : "none";
  if (pad)  pad.style.opacity = locked ? "0.35" : "1";
  if (pad)  pad.style.pointerEvents = locked ? "none" : "auto";
}

function removeOverlay() {
  const o = document.getElementById("activateOverlay");
  if (o) o.remove();
}

function shakeCard() {
  const card = document.getElementById("actvCard");
  if (!card) return;
  card.classList.remove("actv-shake");
  void card.offsetWidth; // reflow
  card.classList.add("actv-shake");
}

// ========= Main =========
(async function main(){
  const cardId = getCardId();

  // ถ้าไม่มี id หรือรูปแบบไม่ถูก -> กันไว้ก่อน
  if (!isValidCardId(cardId)) {
    buildOverlay();
    document.getElementById("actvCardId").textContent = cardId ? `id=${cardId}` : "Missing ?id=";
    setLockedUI(true);
    setMsg("Invalid or missing card id.");
    return;
  }

  // init firebase (safe init)
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // doc ที่เก็บสถานะ activation ของการ์ดนี้
  const ref = doc(db, "cards", cardId);

  // โหลดสถานะ
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    // สร้าง doc เปล่าไว้ก่อน (ช่วยให้โค้ด update ง่าย)
    await setDoc(ref, {
      activated: false,
      activateFails: 0,
      activateLocked: false,
      createdAt: serverTimestamp()
    }, { merge:true });
    snap = await getDoc(ref);
  }

  const data = snap.data() || {};
  const activated = !!data.activated;
  const locked = !!data.activateLocked;
  const fails = Number(data.activateFails || 0);

  // ถ้า activate แล้ว -> ปล่อยเข้าเว็บเดิมเลย
  if (activated) return;

  // ยังไม่ activate -> show overlay
  buildOverlay();
  document.getElementById("actvCardId").textContent = `id=${cardId}`;

  setTries(Math.min(fails, MAX_TRIES));
  setLockedUI(locked);

  if (locked) {
    setMsg("");
    return;
  }

  let input = "";

  function updateUI() {
    setDots(input);
  }

  async function failOnce() {
    // เพิ่ม fail ใน Firestore
    await updateDoc(ref, { activateFails: increment(1) });
    const s = await getDoc(ref);
    const d = s.data() || {};
    const newFails = Number(d.activateFails || 0);

    setTries(Math.min(newFails, MAX_TRIES));
    shakeCard();

    const left = Math.max(0, MAX_TRIES - newFails);
    if (left <= 0) {
      // lock ถาวร
      await updateDoc(ref, { activateLocked: true });
      setLockedUI(true);
      setMsg("");
      return;
    }

    setMsg(`Incorrect code. ${left} attempt(s) remaining.`);
    input = "";
    updateUI();
  }

  async function succeed() {
    // activate!
    await updateDoc(ref, {
      activated: true,
      activatedAt: serverTimestamp()
    });
    removeOverlay(); // เข้าเว็บเดิมต่อทันที
  }

  function press(n) {
    if (input.length >= 6) return;
    input += String(n);
    setMsg("");
    updateUI();

    if (input.length === 6) {
      // เช็ค pin
      if (input === ACTIVATE_PIN) {
        succeed();
      } else {
        failOnce();
      }
    }
  }

  // keypad events
  document.getElementById("actvPad").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.n !== undefined) press(btn.dataset.n);
  });

  document.getElementById("actvClear").addEventListener("click", () => {
    input = "";
    setMsg("");
    updateUI();
  });

  document.getElementById("actvBack").addEventListener("click", () => {
    input = input.slice(0, -1);
    setMsg("");
    updateUI();
  });

  updateUI();
})();


