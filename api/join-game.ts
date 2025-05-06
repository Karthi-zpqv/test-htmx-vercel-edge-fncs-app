import { NextRequest, NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// --- Firebase Admin Initialization (Edge) ---
function getFirebaseApp() {
  if (!getApps().length) {
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

export const config = {
  runtime: "experimental-edge",
};

// POST /api/join-game
export default async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse("Method Not Allowed", { status: 405 });
  }

  try {
    const db = getFirebaseApp();
    const body = (await req.json()) as { gameCode?: string; userId?: string };
    const gameCodeRaw = body.gameCode || "";
    const userId =
      body.userId ||
      req.headers.get("x-firebase-uid") ||
      "anon_" + Math.random().toString(36).slice(2, 8);

    const gameCode = String(gameCodeRaw)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    if (!gameCode || !userId) {
      return new NextResponse(
        JSON.stringify({
          ok: false,
          error: "invalid_code",
          details: "Missing game code.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Lookup game by code
    const gameQuery = await db
      .collection("games")
      .where("code", "==", gameCode)
      .limit(1)
      .get();
    if (gameQuery.empty) {
      // HTML or JSON error partial
      return errorResponse("not_found", "No game found with that code.", req);
    }
    const doc = gameQuery.docs[0];
    const data = doc.data();
    const gameId = doc.id;

    // Already full or player already joined
    if (Array.isArray(data.players) && data.players.length >= 2) {
      // Check if player is already in the list (rejoin allowed)
      const already = data.players.some((p: any) => p.uid === userId);
      if (!already) {
        return errorResponse(
          "game_full",
          "This game already has two players.",
          req
        );
      }
      // Already joined, let them join lobby
    }

    // Add player if not yet present
    const alreadyPresent = Array.isArray(data.players)
      ? data.players.some((p: any) => p.uid === userId)
      : false;
    let assignedColor = "black";
    let newPlayersArr = data.players || [];
    if (!alreadyPresent) {
      assignedColor = data.players?.length === 0 ? "white" : "black";
      const playerObj = {
        uid: userId,
        color: assignedColor,
        joinedAt: FieldValue.serverTimestamp(),
      };
      // Add the new player
      newPlayersArr = [...(data.players || []), playerObj];
      await db
        .collection("games")
        .doc(gameId)
        .update({
          players: FieldValue.arrayUnion(playerObj),
          status: newPlayersArr.length >= 2 ? "active" : "waiting",
        });
    } else {
      assignedColor =
        data.players.find((p: any) => p.uid === userId)?.color || "black";
    }

    // Re-fetch the latest document after update
    const updatedDoc = await db.collection("games").doc(gameId).get();
    const updatedData = updatedDoc.data();

    // Determine domain for absolute invite link
    const origin = req.headers.get("x-forwarded-host")
      ? `https://${req.headers.get("x-forwarded-host")}`
      : "https://chess.vercel.app";

    // Respond with HTML partial or JSON
    const accept = req.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      const html = `
<div class="flex flex-col items-center gap-6 px-3 py-8">
  <div class="w-full flex flex-col items-center gap-2">
    <div class="flex flex-row items-center gap-1">
      <span class="uppercase font-mono text-lg tracking-widest text-emerald-800 select-all" id="lobby-game-code" aria-label="Game Code">${gameCode}</span>
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
        href="${origin}/join/${gameCode}"
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

    // JSON response for API clients
    return NextResponse.json({
      ok: true,
      gameCode,
      gameId,
      shareUrl: `${origin}/join/${gameCode}`,
      userColor: assignedColor,
      players: updatedData?.players || [],
      status: updatedData?.status || null,
    });
  } catch (err: any) {
    return errorResponse(err?.message || "Failed to join game", undefined, req);
  }
}

// Helper: Return error as HTMX partial or JSON
function errorResponse(errorCode: string, details?: string, req?: NextRequest) {
  const accept = req?.headers?.get("accept") || "";
  const html = `
<div
  class="w-full flex flex-col items-center py-8 px-4 gap-5"
  role="alert"
  aria-live="assertive"
  aria-atomic="true"
>
  <div class="w-full max-w-md">
    <div class="rounded-lg border border-red-200 bg-red-50 px-5 py-6 shadow flex flex-col items-center text-center">
      <div class="flex items-center justify-center gap-2 mb-2">
        <svg class="w-7 h-7 text-red-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#feebe9"/>
          <path d="M12 7v6m0 4h.01" stroke="#e11d48" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <span class="text-lg font-bold text-red-700">Error</span>
      </div>
      <div class="my-2 text-red-700 text-base font-semibold" id="error-message-region">
        <span id="error-code-label">${errorCode}</span>
      </div>
      <div class="text-sm text-red-600 font-normal opacity-80 mb-1" id="error-details-region">
        ${details || ""}
      </div>
      <button
        data-home-link
        class="mt-6 rounded-md font-semibold px-5 py-2 bg-red-100 hover:bg-red-200 text-red-800 transition border border-red-200"
        tabindex="0"
      >
        &larr; Back to Home
      </button>
    </div>
  </div>
</div>
<script>
  (function () {
    const errorMap = {
      game_full: 'This game is already full.',
      not_found: 'Game not found.',
      invalid_code: 'Invalid game code.',
      network: 'Network error.',
      forbidden: 'You are not allowed to join this game.'
    };
    let label = document.getElementById('error-code-label');
    let code = label && label.innerText && Object.keys(errorMap).includes(label.innerText.trim()) 
      ? label.innerText.trim()
      : null;
    if (code && errorMap[code]) {
      label.innerText = errorMap[code];
    }
  })();
</script>
  `;
  if (accept.includes("text/html")) {
    return new NextResponse(html, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new NextResponse(
    JSON.stringify({
      ok: false,
      error: errorCode,
      details: details || null,
    }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}
