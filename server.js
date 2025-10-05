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

// Color palette for user highlights with matched instruments
const colorInstrumentMap = {
  '#970302': 'AMSynth',      // Red
  '#E679A6': 'DuoSynth',     // Pink
  '#EE8019': 'FMSynth',      // Orange
  '#F0BC00': 'MembraneSynth', // Yellow
  '#5748B5': 'PolySynth',    // Purple
  '#305D70': 'MonoSynth',    // Dark green
  '#0E65C0': 'NoiseSynth',   // Blue
  '#049DFF': 'PluckSynth',   // Bright Blue
  '#E9E7C4': 'PolySynth',    // Bright Yellow
  '#308557': 'Synth',        // Green
  '#71D1B3': 'FMSynth'       // Bright Green
};

const colorPalette = Object.keys(colorInstrumentMap);

// Store active rooms and users
// Structure: { roomId: { users: { socketId: { color, position, trail } } } }
const rooms = new Map();

// Track which color is used in each room
const roomColors = new Map();

// Store historical paths for each room
// Structure: { roomId: { userId: { color, path: [] } } }
const historicalPaths = new Map();

// Get an available color for a room
function getAvailableColor(roomId) {
  if (!roomColors.has(roomId)) {
    roomColors.set(roomId, new Set());
  }
  
  const usedColors = roomColors.get(roomId);
  
  // Get all unused colors
  const availableColors = colorPalette.filter(color => !usedColors.has(color));
  
  // If there are available colors, pick one randomly
  if (availableColors.length > 0) {
    const randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
    usedColors.add(randomColor);
    return randomColor;
  }
  
  // If all colors used, pick random one from all colors
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
    console.log(`🎨 Assigned color to ${socket.id}: ${userColor}`);
    
    // Get instrument matched to the color
    const userInstrument = colorInstrumentMap[userColor];
    console.log(`🎸 Mapped to instrument: ${userInstrument}`);
    
    // Add user to room
    const room = rooms.get(roomId);
    room.users[socket.id] = {
      id: socket.id,
      color: userColor,
      instrument: userInstrument,
      position: 0,
      trail: []
    };
    
    // Send assigned color and instrument to user
    socket.emit('user-color', userColor);
    socket.emit('user-instrument', userInstrument);
    console.log(`🎸 Assigned instrument to ${socket.id}: ${userInstrument}`);
    
    // Send current users in room to new user
    socket.emit('room-users', room.users);
    
    // Send historical paths for this room
    if (historicalPaths.has(roomId)) {
      const roomPaths = historicalPaths.get(roomId);
      const pathsArray = Object.entries(roomPaths).map(([userId, data]) => ({
        userId,
        color: data.color,
        path: data.path
      }));
      socket.emit('historical-paths', { paths: pathsArray });
      console.log(`📜 Sent ${pathsArray.length} historical paths to ${socket.id}`);
    } else {
      socket.emit('historical-paths', { paths: [] });
    }
    
    // Send saved selected paths for this room
    if (historicalPaths.has(roomId)) {
      const roomPaths = historicalPaths.get(roomId);
      const selectedPathsArray = Object.entries(roomPaths)
        .filter(([userId, data]) => data.selectedWords && data.selectedWords.length > 0)
        .map(([userId, data]) => ({
          userId,
          color: data.color,
          selectedWords: data.selectedWords
        }));
      socket.emit('saved-selected-paths', { selectedPaths: selectedPathsArray });
      console.log(`📝 Sent ${selectedPathsArray.length} saved selected paths to ${socket.id}`);
    } else {
      socket.emit('saved-selected-paths', { selectedPaths: [] });
    }
    
    // Notify other users in room about new user
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      color: userColor,
      instrument: userInstrument,
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
      instrument: user.instrument,
      position: wordIndex,
      line: line,
      positionInLine: positionInLine
    });
  });
  
  // User selects a word (with speech)
  socket.on('select-emit', (data) => {
    console.log('📥 SERVER RECEIVED select-emit from', socket.id, 'data:', data);
    
    if (!currentRoom) {
      console.log('⚠️ No current room for', socket.id);
      return;
    }
    
    const room = rooms.get(currentRoom);
    if (!room || !room.users[socket.id]) {
      console.log('⚠️ Room or user not found for', socket.id);
      return;
    }
    
    const user = room.users[socket.id];
    const { wordIndex, line, positionInLine, text } = data;
    
    // Broadcast selection to other users in room
    console.log('📤 SERVER BROADCASTING select-receive to room:', currentRoom);
    socket.to(currentRoom).emit('select-receive', {
      id: socket.id,
      color: user.color,
      position: wordIndex,
      line: line,
      positionInLine: positionInLine,
      text: text
    });
    
    console.log(`✅ User ${socket.id} selected word: "${text}" at index ${wordIndex}`);
  });
  
  // Save user's path
  socket.on('save-path', (data) => {
    if (!currentRoom) return;
    
    const room = rooms.get(currentRoom);
    if (!room || !room.users[socket.id]) return;
    
    const user = room.users[socket.id];
    const { path } = data;
    
    // Initialize room in historicalPaths if needed
    if (!historicalPaths.has(currentRoom)) {
      historicalPaths.set(currentRoom, {});
    }
    
    // Store the path for this user
    const roomPaths = historicalPaths.get(currentRoom);
    roomPaths[socket.id] = {
      color: user.color,
      path: path
    };
    
    console.log(`💾 Saved path for ${socket.id} in room ${currentRoom}: ${path.length} words`);
  });
  
  // Save user's selected words
  socket.on('save-selected-words', (data) => {
    if (!currentRoom) return;
    
    const room = rooms.get(currentRoom);
    if (!room || !room.users[socket.id]) return;
    
    const user = room.users[socket.id];
    const { selectedWords } = data;
    
    // Initialize room in historicalPaths if needed
    if (!historicalPaths.has(currentRoom)) {
      historicalPaths.set(currentRoom, {});
    }
    
    // Store the selected words for this user (in addition to their path)
    const roomPaths = historicalPaths.get(currentRoom);
    if (!roomPaths[socket.id]) {
      roomPaths[socket.id] = {
        color: user.color,
        path: []
      };
    }
    roomPaths[socket.id].selectedWords = selectedWords;
    
    console.log(`📝 Saved selected words for ${socket.id} in room ${currentRoom}: ${selectedWords.length} words`);
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

