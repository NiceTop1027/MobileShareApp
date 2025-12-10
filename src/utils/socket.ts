import { io } from "socket.io-client";

// Connect to the same hostname as the window, but on port 3000
const SIGNALING_SERVER_URL = `${window.location.protocol}//${window.location.hostname}:3000`;

export const socket = io(SIGNALING_SERVER_URL, {
    autoConnect: false,
});
