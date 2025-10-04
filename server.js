const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Color palette for user highlights (must match frontend)
const colorPalette = [
  '#FFB3BA', // Light pink
  '#FFDFBA', // Light peach
  '#FFFFBA', // Light yellow
  '#BAFFC9', // Light mint
  '#BAE1FF', // Light sky blue
  '#E0BBE4', // Light lavender
  '#FFD6A5', // Light apricot
  '#FDFFB6', // Pale yellow
  '#CAFFBF', // Pale mint
  '#9BF6FF', // Pale cyan
  '#A0C4FF', // Pale blue
  '#FFC6FF', // Pale pink
  '#FDCAE1', // Pale rose
  '#FFDAB9', // Peach puff
  '#E6E6FA'  // Lavender
];

// Store active rooms and users
// Structure: { roomId: { users: { socketId: { color, position, trail } } } }
const rooms = new Map();

// Track which color is used in each room
const roomColors = new Map();

// Get an available color for a room
function getAvailableColor(roomId) {
  if (!roomColors.has(roomId)) {
    roomColors.set(roomId, new Set());
  }
  
  const usedColors = roomColors.get(roomId);
  
  // Find first unused color
  for (const color of colorPalette) {
    if (!usedColors.has(color)) {
      usedColors.add(color);
      return color;
    }
  }
  
  // If all colors used, pick random one
  return colorPalette[Math.floor(Math.random() * colorPalette.length)];
}

// Release a color when user leaves
function releaseColor(roomId, color) {
  if (roomColors.has(roomId)) {
    roomColors.get(roomId).delete(color);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoom = null;
  let userColor = null;
  
  // User joins a room (Wikipedia page)
  socket.on('join-room', (roomId) => {
    console.log(`User ${socket.id} joining room: ${roomId}`);
    
    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      removeUserFromRoom(currentRoom, socket.id);
    }
    
    // Join new room
    currentRoom = roomId;
    socket.join(roomId);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { users: {} });
    }
    
    // Assign color to user
    userColor = getAvailableColor(roomId);
    
    // Add user to room
    const room = rooms.get(roomId);
    room.users[socket.id] = {
      id: socket.id,
      color: userColor,
      position: 0,
      trail: []
    };
    
    // Send assigned color to user
    socket.emit('user-color', userColor);
    
    // Send current users in room to new user
    socket.emit('room-users', room.users);
    
    // Notify other users in room about new user
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      color: userColor,
      position: 0,
      trail: []
    });
    
    console.log(`Room ${roomId} now has ${Object.keys(room.users).length} users`);
  });
  
  // User moves to a new position
  socket.on('move', (data) => {
    if (!currentRoom) return;
    
    const room = rooms.get(currentRoom);
    if (!room || !room.users[socket.id]) return;
    
    const user = room.users[socket.id];
    const { wordIndex, line, positionInLine } = data;
    
    // Update user's position
    user.position = wordIndex;
    
    // Add to trail (keep last 50 positions to avoid memory issues)
    user.trail.push(wordIndex);
    if (user.trail.length > 50) {
      user.trail.shift();
    }
    
    // Broadcast movement to other users in room
    socket.to(currentRoom).emit('user-moved', {
      id: socket.id,
      color: user.color,
      position: wordIndex,
      line: line,
      positionInLine: positionInLine
    });
  });
  
  // User disconnects
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (currentRoom) {
      removeUserFromRoom(currentRoom, socket.id);
      
      // Notify other users
      socket.to(currentRoom).emit('user-left', socket.id);
      
      // Release user's color
      if (userColor) {
        releaseColor(currentRoom, userColor);
      }
    }
  });
  
  // Helper function to remove user from room
  function removeUserFromRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    delete room.users[socketId];
    
    // Clean up empty rooms
    if (Object.keys(room.users).length === 0) {
      rooms.delete(roomId);
      roomColors.delete(roomId);
      console.log(`Room ${roomId} is now empty and removed`);
    } else {
      console.log(`Room ${roomId} now has ${Object.keys(room.users).length} users`);
    }
  }
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    totalUsers: Array.from(rooms.values()).reduce((sum, room) => sum + Object.keys(room.users).length, 0)
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Wiki Desire Path backend running on port ${PORT}`);
});

