import { NextRequest, NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// --- Firebase Admin Initialization (Edge) ---
function getFirebaseApp() {
  if (!getApps().length) {
    // Credentials from env vars, not committed to source
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n"
        ),
      }),
    });
  }
  return getFirestore();
}

// Generates a unique, 5-letter alphanumeric game code (uppercase)
async function generateUniqueGameCode(
  db: ReturnType<typeof getFirebaseApp>,
  maxAttempts = 5
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = Math.random().toString(36).substr(2, 5).toUpperCase();
    // Check Firestore for collisions
    const existing = await db
      .collection("games")
      .where("code", "==", code)
      .limit(1)
      .get();
    if (existing.empty) {
      return code;
    }
  }
  throw new Error("Could not generate unique game code.");
}

// POST handler for creating a new game
export const config = {
  runtime: "experimental-edge",
};

export default async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse("Method Not Allowed", { status: 405 });
  }

  try {
    const db = getFirebaseApp();
    const body = (await req.json()) as { userId?: string };
    const userId =
      body.userId ||
      req.headers.get("x-firebase-uid") ||
      "anon_" + Math.random().toString(36).slice(2, 8);

    // Generate code and doc
    const code = await generateUniqueGameCode(db);
    // Player assigned as 'white', slot 0
    const gameDoc = {
      code: code,
      createdAt: FieldValue.serverTimestamp(),
      players: [
        {
          uid: userId,
          color: "white",
          joinedAt: FieldValue.serverTimestamp(),
        },
      ],
      turn: "white",
      boardState: {
        board: [
          ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
          ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
          ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
        ],
        turn: "white",
        castling: { wK: true, wQ: true, bK: true, bQ: true },
        enPassant: null,
        halfmove: 0,
        fullmove: 1,
      },
      moves: [],
      status: "waiting", // lobby until opponent joins
    };

    const docRef = await db.collection("games").add(gameDoc);
    const gameId = docRef.id;

    // Prepare response for HTMX or JSON (Content-Type negotiation)
    const accept = req.headers.get("accept") || "";
    const origin = req.headers.get("x-forwarded-host")
      ? `https://${req.headers.get("x-forwarded-host")}`
      : "https://chess.vercel.app";
    // If Accept: text/html, serve lobby.html partial
    if (accept.includes("text/html")) {
      // HTMX partial: lobby.html with placeholders replaced
      // You may wish to use a template engine, but Edge Functions are limited: inline string here
      const html = `
<div class="flex flex-col items-center gap-6 px-3 py-8">
  <div class="w-full flex flex-col items-center gap-2">
    <div class="flex flex-row items-center gap-1">
      <span class="uppercase font-mono text-lg tracking-widest text-emerald-800 select-all" id="lobby-game-code" aria-label="Game Code">${code}</span>
      <button
        type="button"
        id="copy-code-btn"
        aria-label="Copy game code"
        class="ml-2 p-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200 flex items-center transition-all"
        tabindex="0"
      >
        <svg class="w-5 h-5" stroke="currentColor" fill="none" viewBox="0 0 20 20"><rect x="7" y="5" width="7" height="12" rx="2" stroke-width="1.5"/><rect x="4" y="2" width="7" height="12" rx="2" stroke-width="1.5"/></svg>
      </button>
      <span id="copy-success-msg" class="ml-1 text-emerald-600 text-xs font-medium hidden">Copied!</span>
    </div>
    <div class="w-full flex flex-row items-center justify-between mt-2">
      <a
        href="${origin}/join/${code}"
        target="_blank"
        class="text-emerald-600 underline underline-offset-2 text-sm"
        id="lobby-share-link"
        tabindex="0"
      >
        Invite link
      </a>
      <span class="text-xs text-gray-500 hidden md:inline" tabindex="-1">Share with your friend</span>
    </div>
  </div>

  <div class="w-full flex flex-col items-center gap-4 mt-4">
    <div id="lobby-status"
      class="flex flex-col items-center gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="font-semibold text-emerald-900 text-lg">Waiting for opponent...</span>
      <span class="flex flex-row items-center gap-1 text-emerald-700 text-sm mt-1">
        <svg class="animate-spin w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path d="M12 2a10 10 0 1 1-8.53 4.94" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        <span>Waiting for player to join…</span>
      </span>
    </div>
  </div>
  <button
    data-home-link
    tabindex="0"
    class="mt-8 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold px-6 py-2 rounded-lg text-sm transition-all border border-emerald-200"
  >
    &larr; Back to Home
  </button>
</div>
<script>
  document.getElementById('copy-code-btn')?.addEventListener('click', function () {
    const code = document.getElementById('lobby-game-code')?.innerText?.trim();
    if (!code) return;
    navigator.clipboard.writeText(code).then(function() {
      const msg = document.getElementById('copy-success-msg');
      if (msg) {
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 1500);
      }
    });
  });
  (function () {
    const link = document.getElementById('lobby-share-link');
    if (link && !link.href.includes('{{')) {
      try {
        const code = document.getElementById('lobby-game-code').innerText;
        link.href = location.origin + '/join/' + encodeURIComponent(code);
      } catch (_) {}
    }
  })();
  (function () {
    window.lobbyGameId = '${gameId}';
  })();
</script>
      `;
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Otherwise, serve JSON (for direct API, etc)
    return NextResponse.json({
      ok: true,
      gameCode: code,
      gameId: gameId,
      shareUrl: `${origin}/join/${code}`,
    });
  } catch (err: any) {
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: err?.message || "Failed to create game",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
