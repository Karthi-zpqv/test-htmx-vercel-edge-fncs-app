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
  runtime: "edge",
};

// Minimal move validation helpers (mirroring chessboard.js; backend is authoritative but simple)
function isBasicMoveLegal(
  from: string,
  to: string,
  boardState: any,
  playerColor: string
): boolean {
  // Licensed for minimal server trust: relies on client for full validation
  if (
    !from ||
    !to ||
    !/^[a-h][1-8]$/.test(from) ||
    !/^[a-h][1-8]$/.test(to) ||
    !boardState ||
    !Array.isArray(boardState.board)
  ) {
    return false;
  }
  // Get from and to indices
  const files = "abcdefgh";
  const [fr, fc] = [8 - Number(from[1]), files.indexOf(from[0])];
  const [tr, tc] = [8 - Number(to[1]), files.indexOf(to[0])];
  if (
    fr < 0 ||
    fr > 7 ||
    fc < 0 ||
    fc > 7 ||
    tr < 0 ||
    tr > 7 ||
    tc < 0 ||
    tc > 7
  ) {
    return false;
  }
  const piece = boardState.board[fr][fc];
  if (!piece) return false;
  if (
    (playerColor === "white" && !piece.startsWith("w")) ||
    (playerColor === "black" && !piece.startsWith("b"))
  ) {
    return false;
  }
  // Only allow moving to empty or opponent's piece
  const target = boardState.board[tr][tc];
  if (target && target[0] === piece[0]) return false;
  // Only basic check: From and to are different squares
  if (fr === tr && fc === tc) return false;
  // Advanced move validation is handled client-side and via UI; server trusts client for MVP
  return true;
}

// POST /api/move
export default async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse("Method Not Allowed", { status: 405 });
  }
  try {
    const db = getFirebaseApp();
    const body = (await req.json()) as {
      gameId: string;
      move: any;
      userId?: string;
    };
    const { gameId, move } = body;
    const userId = body.userId || req.headers.get("x-firebase-uid") || null;

    if (!gameId || !move || !move.from || !move.to || !userId) {
      return new NextResponse(
        JSON.stringify({
          ok: false,
          error: "invalid_move",
          details: "Missing required parameters.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Run Firestore transaction to do state update atomically & verify turn
    const result = await db.runTransaction(async (trx) => {
      const gameRef = db.collection("games").doc(gameId);
      const gameSnap = await trx.get(gameRef);
      if (!gameSnap.exists) throw new Error("not_found");
      const data = gameSnap.data();

      // Check player exists
      const playerIdx = data?.players?.findIndex((p: any) => p.uid === userId);
      if (playerIdx === -1 || !Array.isArray(data?.players))
        throw new Error("forbidden");

      // Check not game over
      if (data?.status === "over" || data?.result?.status === "over")
        throw new Error("game_over");

      // Determine player color
      const myColor = playerIdx === 0 ? "white" : "black";

      // Only allow if user's turn
      if (data.turn !== myColor) throw new Error("not_your_turn");

      // Validate move (minimal, ultimate validation by frontend and Firestore triggers)
      if (!isBasicMoveLegal(move.from, move.to, data.boardState, myColor)) {
        throw new Error("illegal_move");
      }

      // Compose move object
      const newMove = {
        from: move.from,
        to: move.to,
        ts: FieldValue.serverTimestamp(),
        player: myColor,
      };

      // Append move to moves array
      const moves = Array.isArray(data.moves)
        ? [...data.moves, newMove]
        : [newMove];

      // Swap turn
      const nextTurn = myColor === "white" ? "black" : "white";

      // Try to update boardState (let client be source; backend authoritatively trusts client for now)
      let newBoard = data.boardState;
      // Optionally, backend may recalc board state with minimal logic or delegate to cloud function

      // Set status if game finished; for MVP, only when both kings present, status=active.
      const update: any = {
        moves,
        turn: nextTurn,
        boardState: newBoard,
      };

      trx.update(gameRef, update);
      return { ...data, ...update, lastMove: newMove };
    });

    return NextResponse.json({
      ok: true,
      state: result,
    });
  } catch (e: any) {
    // Map error to client-facing message
    let code = (e?.message || "").trim() || "server_error";
    let status = 400;
    if (code === "not_found") status = 404;
    else if (code === "forbidden") status = 403;
    else if (code === "illegal_move" || code === "not_your_turn") status = 409;
    else if (code === "game_over") status = 410;
    else if (code === "invalid_move") status = 400;
    else status = 500;
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: code,
        details:
          code === "illegal_move"
            ? "Move is not legal."
            : code === "not_your_turn"
            ? "It is not your turn."
            : code === "forbidden"
            ? "You are not permitted to move in this game."
            : code === "game_over"
            ? "Game is over."
            : code === "not_found"
            ? "Game not found."
            : "Move failed.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
