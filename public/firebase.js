// public/firebase.js
// Client-side Firebase helpers using SDK v11.6.0 (compat, loaded via CDN in HTML)

// This file expects firebase to be loaded globally and a config object to be injected as {
// See index.html for initialization logic

(function (global) {
  // -- Safe Firebase Init --
  function ensureFirebaseInitialized() {
    if (!window.firebase?.apps.length) {
      window.firebase.initializeApp({{firebase_config}});
    }
    return window.firebase.app();
  }

  // -- Optional: Auth --
  function signInAnonymouslyIfEnabled() {
    try {
      const auth = firebase.auth();
      if (!auth.currentUser) {
        return auth.signInAnonymously().catch(() => {});
      }
    } catch (e) {}
  }

  // -- Firestore DB Helpers --
  function getFirestore() {
    ensureFirebaseInitialized();
    return window.firebase.firestore();
  }

  // ---- CREATE GAME ----
  // Creates a new game document in Firestore and returns its ID/code.
  async function createGameInFirestore(userName) {
    ensureFirebaseInitialized();
    const db = getFirestore();
    const uid = firebase.auth().currentUser?.uid || null;

    // Generate simple 5-char code (client can be overridden by backend/Edge API)
    function genCode() {
      return Math.random().toString(36).slice(2, 7).toUpperCase();
    }
    const gameCode = genCode();

    const newGame = {
      code: gameCode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      players: [{ uid: uid, name: userName || "Player1", joinedAt: firebase.firestore.FieldValue.serverTimestamp() }],
      turn: "white",
      boardState: global.chessboard?.generateInitialBoard ? global.chessboard.generateInitialBoard() : null,
      moves: [],
      status: "waiting" // can be 'waiting', 'active', 'over'
    };

    const docRef = await db.collection("games").add(newGame);
    return { gameId: docRef.id, gameCode };
  }

  // ---- JOIN GAME ----
  // Adds current user to existing game, returns gameId if success, throws error otherwise.
  async function joinGameInFirestore(gameCode, userName = "Player2") {
    ensureFirebaseInitialized();
    const db = getFirestore();
    const uid = firebase.auth().currentUser?.uid || null;
    if (!gameCode || !uid) throw new Error("Missing code or user auth");

    const snap = await db.collection("games").where("code", "==", gameCode.toUpperCase()).limit(1).get();
    if (snap.empty) throw new Error("not_found");
    const doc = snap.docs[0];
    const data = doc.data();
    if (!data.players || data.players.length >= 2) throw new Error("game_full");
    const alreadyJoined = data.players.some(p => p.uid === uid);
    if (alreadyJoined) return { gameId: doc.id };

    // Add player to array
    await db.collection("games").doc(doc.id).update({
      players: firebase.firestore.FieldValue.arrayUnion({
        uid,
        name: userName,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
      }),
      status: "active"
    });
    return { gameId: doc.id };
  }

  // ---- LISTEN TO GAME STATE ----
  // Subscribes to updates for a game document. Callback receives game doc data or null on missing.
  function listenOnGameState(gameId, callback) {
    ensureFirebaseInitialized();
    const db = getFirestore();
    if (!gameId) return () => {};
    const unsub = db.collection("games").doc(gameId).onSnapshot(function (doc) {
      callback(doc && doc.exists ? doc.data() : null);
    });
    return unsub;
  }

  // ---- SUBMIT MOVE ----
  // Attempts to submit a move to Firestore; expects {from, to}, minimal UI validation.
  async function submitMoveToFirestore(gameId, move) {
    ensureFirebaseInitialized();
    const db = getFirestore();
    const uid = firebase.auth().currentUser?.uid || null;
    if (!gameId || !move || !move.from || !move.to || !uid) throw new Error("Missing data");

    // Use Firestore transaction for concurrency
    await db.runTransaction(async (trx) => {
      const gameRef = db.collection("games").doc(gameId);
      const doc = await trx.get(gameRef);
      if (!doc.exists) throw new Error("not_found");
      const data = doc.data();

      // Minimal client-side turn enforce
      const playerIdx = data.players?.findIndex(p => p.uid === uid);
      if (playerIdx === -1 || !data.players) throw new Error("forbidden");
      const myColor = playerIdx === 0 ? "white" : "black";
      if (data.turn !== myColor) throw new Error("not_your_turn");

      // Validate move (again, backend should enforce this strictly)
      // Here we simply append to moves, let backend validate
      const newMove = {
        from: move.from,
        to: move.to,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
        player: myColor
      };

      // Update moves and swap turn
      const newMoves = (data.moves || []).concat([newMove]);
      const nextTurn = myColor === "white" ? "black" : "white";

      // Try to advance boardState using chessboard.js (no guarantees, server is source of truth)
      let newBoard = data.boardState;
      if (global.chessboard && typeof global.chessboard.getNextBoardState === "function") {
        const tempNext = global.chessboard.getNextBoardState({ from: move.from, to: move.to }, data.boardState);
        if (tempNext) newBoard = tempNext;
      }

      trx.update(gameRef, {
        moves: newMoves,
        boardState: newBoard,
        turn: nextTurn
      });
    });
    return true;
  }

  // ---- Additional helpers for game actions ----
  async function resignGame(gameId) {
    ensureFirebaseInitialized();
    const db = getFirestore();
    const uid = firebase.auth().currentUser?.uid || null;
    if (!gameId || !uid) throw new Error("Missing data");
    const ref = db.collection("games").doc(gameId);
    await ref.update({
      status: "over",
      result: { status: "over", reason: "resign", winner: null }
    });
  }

  async function restartGame(gameId) {
    ensureFirebaseInitialized();
    const db = getFirestore();
    if (!gameId) throw new Error("Missing gameId");
    const ref = db.collection("games").doc(gameId);
    await ref.update({
      status: "active",
      result: firebase.firestore.FieldValue.delete(),
      boardState: global.chessboard?.generateInitialBoard ? global.chessboard.generateInitialBoard() : null,
      moves: [],
      turn: "white"
    });
  }

  // Export as window.firebaseHelpers
  global.firebaseHelpers = {
    ensureFirebaseInitialized,
    signInAnonymouslyIfEnabled,
    createGameInFirestore,
    joinGameInFirestore,
    listenOnGameState,
    submitMoveToFirestore,
    resignGame,
    restartGame
  };
})(window);
