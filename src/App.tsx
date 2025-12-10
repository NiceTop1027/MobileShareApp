import React, { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from './utils/socket';
import { Send, Download, ArrowRight, FileText, CheckCircle } from 'lucide-react';
import './index.css';

// Types
type AppState = 'HOME' | 'SENDER_WAITING' | 'RECEIVER_INPUT' | 'TRANSFERRING' | 'COMPLETED';
type TransferRole = 'SENDER' | 'RECEIVER' | null;

// Security: Input validation and sanitization
const sanitizeInput = (input: string): string => {
  return input.replace(/[^0-9]/g, '').slice(0, 6);
};

const isValidCode = (code: string): boolean => {
  return /^\d{6}$/.test(code);
};

const isAllowedFileType = (file: File): boolean => {
  // Security: Block executable and potentially dangerous files
  const dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
    '.app', '.deb', '.rpm', '.dmg', '.pkg', '.sh', '.bash', '.ps1'
  ];

  const fileName = file.name.toLowerCase();
  return !dangerousExtensions.some(ext => fileName.endsWith(ext));
};

const sanitizeFileName = (name: string): string => {
  // Remove path traversal attempts and dangerous characters
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+/, '_');
};

function App() {
  const [appState, setAppState] = useState<AppState>('HOME');
  const [role, setRole] = useState<TransferRole>(null);
  const [sessionCode, setSessionCode] = useState<string>('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // WebRTC Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);

  // Transfer State Refs (Mutable, non-rendering)
  const transferState = useRef<{
    buffer: BlobPart[];
    size: number;
    meta: { name: string; size: number; mime: string } | null;
  }>({ buffer: [], size: 0, meta: null });

  const downloadFile = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleReceiveFile = useCallback((data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'metadata') {
          // Security: Validate metadata
          if (!msg.name || !msg.size || typeof msg.size !== 'number') {
            setErrorMessage('잘못된 파일 메타데이터입니다');
            return;
          }

          // Security: Sanitize filename
          const safeName = sanitizeFileName(msg.name);

          // Security: Validate file size
          const maxSize = 100 * 1024 * 1024; // 100MB
          if (msg.size > maxSize || msg.size <= 0) {
            setErrorMessage('파일 크기가 유효하지 않습니다');
            return;
          }

          transferState.current.meta = { ...msg, name: safeName };
          transferState.current.buffer = [];
          transferState.current.size = 0;
          setStatusMessage(`${safeName} 수신 중...`);
        }
      } catch (e) {
        console.error('Failed to parse metadata:', e);
        setErrorMessage('파일 메타데이터 수신에 실패했습니다');
      }
    } else {
      // ArrayBuffer
      const { meta } = transferState.current;
      if (!meta) return;

      transferState.current.buffer.push(data);
      transferState.current.size += data.byteLength;

      const percentage = Math.min(100, Math.round((transferState.current.size / meta.size) * 100));
      setProgress(percentage);

      if (transferState.current.size >= meta.size) {
        const blob = new Blob(transferState.current.buffer, { type: meta.mime });
        downloadFile(blob, meta.name);
        setAppState('COMPLETED');
        setStatusMessage('File received!');
      }
    }
  }, [downloadFile, setAppState, setProgress, setStatusMessage]);

  const sendFile = useCallback((file: File) => {
    const dc = dataChannel.current;
    if (!dc) return;

    // Security: Sanitize filename before sending
    const safeName = sanitizeFileName(file.name);

    // Send Metadata
    dc.send(JSON.stringify({ type: 'metadata', name: safeName, size: file.size, mime: file.type }));

    const chunkSize = 16384;
    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
      if (dc.readyState !== 'open') return;

      const buffer = e.target?.result as ArrayBuffer;
      dc.send(buffer);
      offset += buffer.byteLength;

      const percentage = Math.min(100, Math.round((offset / file.size) * 100));
      setProgress(percentage);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        setAppState('COMPLETED');
        setStatusMessage('File sent successfully!');
      }
    };

    const readSlice = (o: number) => {
      const slice = file.slice(o, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  }, [setAppState, setProgress, setStatusMessage]);

  // We need a stable ref to 'files' for the closure in setupDataChannel -> onopen
  // Or utilize a ref for files access
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  const startWebRTC = useCallback((isInitiator: boolean) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnection.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { code: sessionCode, type: 'candidate', payload: event.candidate });
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel("fileTransfer");
      dataChannel.current = dc;
      dc.onopen = () => {
        setAppState('TRANSFERRING');
        if (filesRef.current) {
          sendFile(filesRef.current[0]);
        }
      };
      dc.onmessage = (event) => handleReceiveFile(event.data);

      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('signal', { code: sessionCode, type: 'offer', payload: offer });
      });
    } else {
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dataChannel.current = dc;
        dc.onopen = () => setAppState('TRANSFERRING');
        dc.onmessage = (event) => handleReceiveFile(event.data);
      };
    }
  }, [sessionCode, setAppState, sendFile, handleReceiveFile]);

  // 4. Effects (Depends on startWebRTC)
  useEffect(() => {
    // Setup Socket Listeners
    socket.connect();

    socket.on('session-created', (code) => {
      setSessionCode(code);
      setAppState('SENDER_WAITING');
    });

    socket.on('session-connected', () => {
      setStatusMessage('Peer connected! Starting handshake...');
      if (role === 'SENDER') {
        startWebRTC(true);
      }
    });

    socket.on('signal', async ({ type, payload }) => {
      try {
        if (!peerConnection.current) startWebRTC(false);

        const pc = peerConnection.current!;
        if (type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { code: sessionCode, type: 'answer', payload: answer });
        } else if (type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
        } else if (type === 'candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        }
      } catch (e) {
        console.error("WebRTC signaling error:", e);
        setErrorMessage('연결에 실패했습니다. 다시 시도해주세요.');
      }
    });

    socket.on('error', (error: string) => {
      setErrorMessage(error);
      setAppState('HOME');
    });

    socket.on('connect_error', () => {
      setErrorMessage('서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.');
    });

    return () => {
      socket.off('session-created');
      socket.off('session-connected');
      socket.off('signal');
      socket.off('error');
      socket.off('connect_error');
    };
  }, [role, sessionCode, startWebRTC]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];

      // Security: Check file type
      if (!isAllowedFileType(file)) {
        setErrorMessage('보안상의 이유로 실행 파일은 전송할 수 없습니다');
        e.target.value = ''; // Clear file input
        return;
      }

      // Security: File size limit: 100MB
      const maxSize = 100 * 1024 * 1024;
      if (file.size > maxSize) {
        setErrorMessage(`파일이 너무 큽니다. 최대 크기: 100MB / 선택한 파일: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        e.target.value = '';
        return;
      }

      // Security: Validate file size is not 0
      if (file.size === 0) {
        setErrorMessage('빈 파일은 전송할 수 없습니다');
        e.target.value = '';
        return;
      }

      setFiles(e.target.files);
      setRole('SENDER');
      setErrorMessage(null);
      socket.emit('create-session');
    }
  }, [setFiles, setRole]);

  const handleReceiveClick = useCallback(() => {
    setRole('RECEIVER');
    setAppState('RECEIVER_INPUT');
  }, [setRole, setAppState]);

  const handleJoinSession = useCallback(() => {
    // Security: Validate code before sending
    if (!isValidCode(sessionCode)) {
      setErrorMessage('유효하지 않은 코드입니다 (6자리 숫자만 입력 가능)');
      return;
    }
    socket.emit('join-session', sessionCode);
  }, [sessionCode]);

  const reset = useCallback(() => {
    setAppState('HOME');
    setRole(null);
    setFiles(null);
    setProgress(0);
    setSessionCode('');
    setErrorMessage(null);
    setStatusMessage('');
    // Cleanup WebRTC
    if (dataChannel.current) {
      dataChannel.current.close();
      dataChannel.current = null;
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    socket.disconnect();
    transferState.current = { buffer: [], size: 0, meta: null };
  }, [setAppState, setRole, setFiles, setProgress, setSessionCode]);

  // Render Helpers
  const renderHome = () => (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="app-header">
        <div className="header-content">
          <img src="/school-logo.png" alt="School Logo" className="school-logo" />
          <div className="header-text">
            <h1 className="brand-title">QuickShare</h1>
            <p className="brand-subtitle">빠르고 안전한 파일 전송</p>
          </div>
        </div>
      </header>

      <div className="content-area">
        <label className="action-card send-card">
          <input
            type="file"
            className="file-input"
            onChange={handleFileSelect}
          />
          <div className="card-inner">
            <div className="icon-wrapper send-icon">
              <Send size={32} strokeWidth={2} />
            </div>
            <h2 className="card-title">파일 보내기</h2>
            <p className="card-desc">6자리 코드를 생성하여 파일을 공유하세요</p>
            <div className="card-arrow">→</div>
          </div>
        </label>

        <div className="action-card receive-card" onClick={handleReceiveClick}>
          <div className="card-inner">
            <div className="icon-wrapper receive-icon">
              <Download size={32} strokeWidth={2} />
            </div>
            <h2 className="card-title">파일 받기</h2>
            <p className="card-desc">코드를 입력하여 파일을 다운로드하세요</p>
            <div className="card-arrow">→</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSenderWaiting = () => (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="app-header">
        <div className="header-content">
          <img src="/school-logo.png" alt="School Logo" className="school-logo" />
          <div className="header-text">
            <h1 className="brand-title">전송 준비 완료</h1>
            <p className="brand-subtitle">받는 사람에게 코드를 공유하세요</p>
          </div>
        </div>
      </header>

      <div className="content-area">
        <div className="code-card">
          <p className="code-label">전송 코드</p>
          <div className="code-display pulse-animation">{sessionCode.substring(0, 3)} {sessionCode.substring(3)}</div>
          <div className="waiting-indicator">
            <div className="dot-pulse"></div>
            <p className="waiting-text">연결 대기 중...</p>
          </div>
        </div>
        <button onClick={reset} className="btn-cancel">전송 취소</button>
      </div>
    </div>
  );

  const renderReceiverInput = () => (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="app-header">
        <div className="header-content">
          <img src="/school-logo.png" alt="School Logo" className="school-logo" />
          <div className="header-text">
            <h1 className="brand-title">파일 받기</h1>
            <p className="brand-subtitle">보낸 사람의 6자리 코드를 입력하세요</p>
          </div>
        </div>
      </header>

      <div className="content-area">
        <div className="input-card">
          <p className="input-label">전송 코드 입력</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000 000"
            className="input-code"
            value={sessionCode}
            onChange={(e) => setSessionCode(sanitizeInput(e.target.value))}
            autoFocus
            autoComplete="off"
          />
          <button
            className="btn-primary"
            onClick={handleJoinSession}
            disabled={sessionCode.length !== 6}
          >
            <span>연결하기</span>
            <ArrowRight size={20} strokeWidth={2.5} />
          </button>
        </div>
        <button onClick={reset} className="btn-secondary">돌아가기</button>
      </div>
    </div>
  );

  const renderTransfer = () => (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="app-header">
        <div className="header-content">
          <img src="/school-logo.png" alt="School Logo" className="school-logo" />
          <div className="header-text">
            <h1 className="brand-title">{progress === 100 ? '전송 완료' : '파일 전송 중'}</h1>
            <p className="brand-subtitle">{statusMessage || '파일을 전송하고 있습니다'}</p>
          </div>
        </div>
      </header>

      <div className="content-area">
        <div className="transfer-card">
          {progress === 100 ? (
            <div className="success-animation">
              <div className="success-icon-wrapper">
                <CheckCircle size={64} strokeWidth={2} />
              </div>
              <h3 className="success-title">전송 성공!</h3>
            </div>
          ) : (
            <div className="transfer-animation">
              <div className="transfer-icon-wrapper">
                <FileText size={64} strokeWidth={2} className="file-bounce" />
              </div>
            </div>
          )}

          <div className="progress-section">
            <div className="progress-header">
              <span className="progress-label">진행률</span>
              <span className="progress-percent">{progress}%</span>
            </div>
            <div className="progress-container">
              <div
                className="progress-fill"
                style={{
                  width: `${progress}%`,
                  backgroundColor: progress === 100 ? 'var(--accent-success)' : 'var(--primary-brand)'
                }}
              ></div>
            </div>
          </div>
        </div>

        <button className="btn-secondary" onClick={reset}>
          {progress === 100 ? '다른 파일 보내기' : '취소'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {errorMessage && (
        <div className="error-toast">
          {errorMessage}
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              marginLeft: '12px',
              background: 'none',
              border: 'none',
              color: '#dc2626',
              cursor: 'pointer',
              fontSize: '20px',
              fontWeight: 'bold',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}
      {appState === 'HOME' && renderHome()}
      {appState === 'SENDER_WAITING' && renderSenderWaiting()}
      {appState === 'RECEIVER_INPUT' && renderReceiverInput()}
      {(appState === 'TRANSFERRING' || appState === 'COMPLETED') && renderTransfer()}
    </>
  );
}

export default App;
