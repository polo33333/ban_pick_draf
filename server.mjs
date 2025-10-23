import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Phục vụ các tệp tĩnh từ thư mục gốc (cho style.css và script.js)
app.use(express.static(__dirname));

// Phục vụ thư mục icon và background
// Cấu hình để phục vụ các tệp tĩnh từ thư mục 'assets'
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/icon', express.static(path.join(process.cwd(), 'icon')));
app.use('/background', express.static(path.join(process.cwd(), 'background')));
// ---- Lưu trạng thái các phòng ----
const rooms = {};

// ---- Tạo draft order 2 phase ----
function generateDraftOrder(firstPlayerId, secondPlayerId, phase = 1) {
  const firstTeam = firstPlayerId;
  const secondTeam = secondPlayerId;
  const phase1 = [
    { team: firstTeam, type: "ban" },
    { team: secondTeam, type: "ban" },
    { team: firstTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
  ];

  // Phase 2: đảo team và đảm bảo team thứ hai bắt đầu
  const phase2 = [
    { team: secondTeam, type: "ban" }, // Team đi sau ở phase 1 sẽ ban trước ở phase 2
    { team: firstTeam, type: "ban" },
    { team: secondTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: firstTeam, type: "pick" },
    { team: secondTeam, type: "pick" },
  ];

  return phase === 1 ? phase1 : phase2;
}

// ---- Helper: gửi state an toàn ----
function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const safeRoom = {
    id: room.id,
    actions: room.actions,
    currentTurn: room.currentTurn,
    nextTurn: room.nextTurn,
    hostId: room.hostId,
    countdown: room.countdown,
    countdownDuration: room.countdownDuration,
    phase: room.phase,
    players: room.players,
    paused: room.paused,
    draftOrder: room.draftOrder,
    playerOrder: room.playerOrder,
    playerHistory: room.playerHistory,
  };

  io.to(roomId).emit("room-state", safeRoom);
}

// ---- Countdown xử lý ----
function startCountdown(roomId) {
  // Hàm này bắt đầu một lượt mới, reset thời gian về 30s
  const room = rooms[roomId];
  if (!room) return;

  clearInterval(room.timer);
  room.countdown = room.countdownDuration || 30;
  room.paused = false;

  // Logic chạy timer
  room.timer = setInterval(() => {
    room.countdown--;
    broadcastRoomState(roomId);

    if (room.countdown <= 0) {
      clearInterval(room.timer);
      handleTimeout(roomId);
    }
  }, 1000);
}

function resumeCountdown(roomId) {
  // Hàm này cho chạy tiếp timer đã bị tạm dừng
  const room = rooms[roomId];
  if (!room || !room.paused) return;

  clearInterval(room.timer);
  room.paused = false;

  room.timer = setInterval(() => {
    room.countdown--;
    broadcastRoomState(roomId);

    if (room.countdown <= 0) {
      clearInterval(room.timer);
      handleTimeout(roomId);
    }
  }, 1000);
}

// ---- Chuyển lượt ----
function nextTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.currentTurn++;

  if (room.currentTurn >= room.draftOrder.length) {
    if (room.phase === 1) {
      // Hết phase 1, chuyển sang phase 2
      startPhase2(roomId);
      return;
    } else {
      // Hết phase 2, Draft kết thúc
      clearInterval(room.timer);
      room.nextTurn = null;
      broadcastRoomState(roomId); // Gửi trạng thái cuối cùng
      io.to(roomId).emit("draft-finished", {
        actions: room.actions,
        draftOrder: room.draftOrder,
      });
      return;
    }
  }

  room.nextTurn = room.draftOrder[room.currentTurn];
  startCountdown(roomId);
  broadcastRoomState(roomId);
}

// ---- Xử lý hết giờ ----
function handleTimeout(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Hết giờ, tự động skip lượt
  const turn = room.draftOrder[room.currentTurn];
  if (turn) {
    room.actions.push({ team: turn.team, type: turn.type, champ: "SKIPPED" });
  }
  nextTurn(roomId);
}

// ---- Bắt đầu phase 2 ----
function startPhase2(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.phase = 2;

  // Đảo lượt ban/pick giữa các đội
  // Xác định ID của cả 2 người chơi để tạo lượt cho phase 2
  const firstPlayerIdPhase1 = room.draftOrder[0].team;
  const secondPlayerIdPhase1 = room.playerOrder.find(id => id !== firstPlayerIdPhase1);
  room.draftOrder = generateDraftOrder(firstPlayerIdPhase1, secondPlayerIdPhase1, 2);

  // Đặt lại trạng thái lượt
  room.currentTurn = 0;
  room.nextTurn = room.draftOrder[0];

  // Bắt đầu đếm ngược và phát broadcast
  startCountdown(roomId);
  broadcastRoomState(roomId);
}

// ---- Khi client kết nối ----
io.on("connection", socket => {
  console.log("Socket connected:", socket.id);
  socket.on("join-room", ({ roomId, role, playerName }) => {
    // Tạo phòng nếu chưa có
    if (role === 'host' && !rooms[roomId]) {
        rooms[roomId] = {
            id: roomId,
            actions: [],
            currentTurn: -1,
            nextTurn: null,
            hostId: socket.id,
            countdownDuration: 30,
            timer: null,
            draftOrder: [],
            phase: 1,
            paused: false,
            players: {}, // { socketId: { name: '...' } }
            playerOrder: [], // [socketId1, socketId2]
            playerHistory: {}, // { socketId: { name: '...' } } - để lưu tên khi disconnect
        };
        console.log(`Room created: ${roomId} (host ${socket.id})`);
    }

    const room = rooms[roomId];
    if (!room) {
      return socket.emit("draft-error", { message: "Room not found." });
    }

    // Gán dữ liệu cho socket
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    if (role === 'player') {
      // Logic khôi phục session cho người chơi kết nối lại
      const oldPlayerEntry = Object.entries(room.playerHistory).find(([id, data]) => data.name === playerName && !room.players[id]);

      if (oldPlayerEntry) {
        const oldSocketId = oldPlayerEntry[0];
        const newSocketId = socket.id;
        console.log(`Player ${playerName} reconnected. Mapping ${oldSocketId} to ${newSocketId}`);

        // Cập nhật lại các cấu trúc dữ liệu với socket.id mới
        // 1. Cập nhật playerOrder
        const playerIndex = room.playerOrder.indexOf(oldSocketId);
        if (playerIndex > -1) {
          room.playerOrder[playerIndex] = newSocketId;
        }

        // 2. Cập nhật players và playerHistory
        room.players[newSocketId] = room.playerHistory[oldSocketId];
        delete room.playerHistory[oldSocketId];
        room.playerHistory[newSocketId] = room.players[newSocketId];

        // 3. Cập nhật draftOrder (nếu draft đã bắt đầu)
        room.draftOrder.forEach(turn => {
          if (turn.team === oldSocketId) {
            turn.team = newSocketId;
          }
        });

        // 4. Cập nhật actions (QUAN TRỌNG)
        room.actions.forEach(action => {
          if (action.team === oldSocketId) {
            action.team = newSocketId;
          }
        });

        // 4. Cập nhật nextTurn
        if (room.nextTurn?.team === oldSocketId) {
          room.nextTurn.team = newSocketId;
        }

      } else if (Object.keys(room.players).length >= 2) {
        return socket.emit("draft-error", { message: "Room is full." });
      } else {
        // Logic cho người chơi mới
        const playerData = { name: playerName };
        room.players[socket.id] = playerData;
        room.playerHistory[socket.id] = playerData;
        room.playerOrder.push(socket.id);
        console.log(`Player ${playerName} (${socket.id}) joined room ${roomId}`);
      }
    } else if (role === 'host') {
      // Cập nhật hostId nếu host kết nối lại
      room.hostId = socket.id;
    }

    broadcastRoomState(roomId);
  });

  socket.on("choose-first", ({ roomId, team }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || room.draftOrder.length > 0) return;

    if (room.playerOrder.length !== 2) {
      return socket.emit("draft-error", { message: "Cần có đủ 2 người chơi để bắt đầu." });
    }

    const firstPlayerId = team;
    const secondPlayerId = room.playerOrder.find(id => id !== firstPlayerId);

    room.draftOrder = generateDraftOrder(firstPlayerId, secondPlayerId, 1);
    room.currentTurn = 0;
    room.phase = 1;
    room.nextTurn = room.draftOrder[0];
    
    startCountdown(roomId);
    broadcastRoomState(roomId);
  });

  socket.on("select-champ", ({ roomId, champ }) => {
    const room = rooms[roomId];
    if (!room) return;

    const turn = room.draftOrder[room.currentTurn];
    if (!turn) return;
    if (socket.id !== turn.team) return; // Kiểm tra bằng socket.id

    room.actions.push({ team: turn.team, type: turn.type, champ });
    nextTurn(roomId);
    // Không cần broadcast ở đây nữa vì nextTurn đã xử lý
  });

  socket.on("pre-select-champ", ({ roomId, champ }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Gửi cập nhật chọn nháp cho những người khác trong phòng (bao gồm cả host)
    socket.to(roomId).emit("pre-select-update", { champ });
  });

  // --- Host Control Handlers ---

  socket.on('close-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.hostId === socket.id) {
      io.to(roomId).emit("host-left"); // Thông báo cho tất cả client
      clearInterval(room.timer);
      delete rooms[roomId];
      console.log(`Room ${roomId} closed by host.`);
    }
  });

  socket.on('toggle-pause', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.hostId === socket.id && room.nextTurn) {
      if (room.paused) {
        resumeCountdown(roomId);
        console.log(`Room ${roomId} resumed by host.`);
      } else {
        clearInterval(room.timer);
        room.paused = true;
        console.log(`Room ${roomId} paused by host.`);
        broadcastRoomState(roomId);
      }
    }
  });

  socket.on('set-countdown', ({ roomId, time }) => {
    const room = rooms[roomId];
    if (room && room.hostId === socket.id && time > 0) {
      room.countdownDuration = time;
      console.log(`Room ${roomId} countdown set to ${time}s by host.`);
      // Cập nhật ngay cho client thấy
      broadcastRoomState(roomId);
    }
  });

  socket.on('kick-player', ({ roomId, playerIdToKick }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    const kickedSocket = io.sockets.sockets.get(playerIdToKick);
    if (kickedSocket) {
      kickedSocket.emit('kicked', { reason: 'Kicked by host' });
      kickedSocket.leave(roomId);
      kickedSocket.disconnect(true); // true để đóng kết nối low-level
      console.log(`Kicked player ${room.playerHistory[playerIdToKick]?.name} (${playerIdToKick}) from room ${roomId}`);
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (room && room.hostId === socket.id) {
      // Host rời đi, đóng phòng
      io.to(roomId).emit("host-left");
      clearInterval(room.timer);
      delete rooms[roomId];
      console.log(`Room ${roomId} closed (host left)`);
    } else if (room) {
      handlePlayerDisconnect(socket);
    }
  });

  function handlePlayerDisconnect(socket) {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    // Xóa người chơi khỏi danh sách active
    delete room.players[socket.id];

    // Nếu draft đang diễn ra, tự động pause
    if (room.nextTurn && !room.paused) {
      clearInterval(room.timer);
      room.paused = true;
      console.log(`Room ${roomId} paused due to player disconnect.`);
    }

    console.log(`Player ${socket.id} disconnected from room ${roomId}`);
    // Gửi trạng thái phòng mới nhất cho tất cả người chơi còn lại
    broadcastRoomState(roomId);
  }
});

// ---- Serve UI test ----
app.get("/characters", async (req, res) => {
  try {
    const data = await fs.readFile(path.join(__dirname, 'character_local.json'), 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (error) {
    console.error("Failed to load character_local.json:", error);
    res.status(500).send("Error loading character data");
  }
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

server.listen(PORT, () =>
  console.log(`Draft server running on http://localhost:${PORT}`)
);
