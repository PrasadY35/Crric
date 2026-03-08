import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Users, MessageSquare, Send, Share2, Trophy, Tv, Volume2, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

export default function App() {
  const [roomId, setRoomId] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [username, setUsername] = useState('');
  const [streamUrl, setStreamUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
  const [showSettings, setShowSettings] = useState(false);
  const [isWebsite, setIsWebsite] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || localStreamRef.current;
    }
  }, [remoteStream, isSharingScreen]);

  // Check if URL is a website or a direct video
  useEffect(() => {
    const isWeb = streamUrl.includes('hotstar.com') || streamUrl.includes('youtube.com') || !streamUrl.match(/\.(mp4|m3u8|webm|ogg)$|^data:video/i);
    setIsWebsite(isWeb);
  }, [streamUrl]);

  // Initialize room from URL or generate new one
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rId = params.get('room');
    if (rId) {
      setRoomId(rId);
    } else {
      const newId = Math.random().toString(36).substring(7);
      setRoomId(newId);
    }
  }, []);

  useEffect(() => {
    if (joined && roomId) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?room=${roomId}`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => setIsConnected(true);
      socket.onclose = () => setIsConnected(false);
      socket.onerror = () => setIsConnected(false);

        socket.onmessage = async (event) => {
          const data = JSON.parse(event.data);
          
          if (data.type === 'sync') {
            if (videoRef.current) {
              // Update stream URL if it changed
              if (data.url && data.url !== streamUrl) {
                setStreamUrl(data.url);
              }
  
              // Avoid infinite loops by checking if we're already close enough
              const timeDiff = Math.abs(videoRef.current.currentTime - data.time);
              if (timeDiff > 0.5) {
                videoRef.current.currentTime = data.time;
              }
              
              if (data.playing && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
              } else if (!data.playing && !videoRef.current.paused) {
                videoRef.current.pause();
              }
            }
          } else if (data.type === 'chat') {
            setMessages(prev => [...prev, data.message]);
          } else if (data.type === 'webrtc-offer') {
            await handleOffer(data.offer);
          } else if (data.type === 'webrtc-answer') {
            await handleAnswer(data.answer);
          } else if (data.type === 'webrtc-ice') {
            await handleIceCandidate(data.candidate);
          } else if (data.type === 'stop-sharing') {
            setIsSharingScreen(false);
            setRemoteStream(null);
          }
        };

      return () => {
        socket.close();
        stopScreenShare();
      };
    }
  }, [joined, roomId]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'webrtc-ice',
          candidate: event.candidate
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track');
      setRemoteStream(event.streams[0]);
      setIsSharingScreen(true);
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const startScreenShare = async () => {
    if (!isConnected) {
      alert("Please wait for the stadium connection to be ready.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true, 
        audio: true 
      });
      localStreamRef.current = stream;
      setIsSharingScreen(true);

      const pc = createPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'webrtc-offer',
          offer
        }));
      }

      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err: any) {
      console.error('Error sharing screen:', err);
      if (err.name === 'NotAllowedError' || err.message.includes('permissions policy')) {
        alert("⚠️ Browser Security Block: Screen sharing is restricted inside this preview window.\n\nPlease open the app in a NEW TAB using the 'Shared App URL' to use this feature!");
      } else {
        alert("Failed to share screen: " + err.message);
      }
    }
  };

  const stopScreenShare = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    setIsSharingScreen(false);
    setRemoteStream(null);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'stop-sharing' }));
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'webrtc-answer',
        answer
      }));
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    try {
      await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ice candidate', e);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Join button clicked with username:', username);
    if (username.trim()) {
      setJoined(true);
      // Update URL without refreshing
      const newUrl = `${window.location.pathname}?room=${roomId}`;
      window.history.pushState({ path: newUrl }, '', newUrl);
    }
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    const nextState = !videoRef.current.paused;
    
    socketRef.current?.send(JSON.stringify({
      type: 'sync',
      playing: !nextState,
      time: videoRef.current.currentTime
    }));
  };

  const handleSeek = () => {
    if (!videoRef.current) return;
    socketRef.current?.send(JSON.stringify({
      type: 'sync',
      playing: !videoRef.current.paused,
      time: videoRef.current.currentTime
    }));
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      user: username,
      text: inputText,
      timestamp: Date.now()
    };

    socketRef.current?.send(JSON.stringify({
      type: 'chat',
      message: newMessage
    }));

    setInputText('');
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Invite link copied! Send it to your friend.');
  };

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(circle_at_center,_var(--accent)_0%,_transparent_100%)] bg-opacity-5">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-8 w-full max-w-md text-center space-y-6"
        >
          <div className="flex justify-center">
            <div className="p-4 bg-orange-500/20 rounded-full">
              <Trophy className="w-12 h-12 text-orange-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">CricParty Live</h1>
          <p className="text-zinc-400">Watch IND vs NZ with your friends in sync.</p>
          
          <form onSubmit={handleJoin} className="space-y-4 text-left">
            <div>
              <label className="text-xs uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Your Name</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-orange-500 transition-colors"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-lg transition-all transform active:scale-95 flex items-center justify-center gap-2"
            >
              <Tv className="w-5 h-5" />
              Enter Stadium
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Main Content */}
      <div className="flex-1 flex flex-col p-4 lg:p-6 space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg">IND vs NZ • Live Match</h1>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 2 Watching</span>
                <span className="w-1 h-1 rounded-full bg-zinc-700"></span>
                <span className="text-orange-500 font-bold">LIVE</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                if (isSharingScreen && localStreamRef.current) {
                  stopScreenShare();
                } else {
                  startScreenShare();
                }
              }}
              className={`glass-panel px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                isSharingScreen && localStreamRef.current ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'hover:bg-white/10'
              }`}
              title={isSharingScreen && localStreamRef.current ? "Stop Sharing" : "Share Screen"}
            >
              <Maximize2 className="w-4 h-4" />
              {isSharingScreen && localStreamRef.current ? "Stop Sharing" : "Share Screen"}
            </button>
            <button 
              onClick={() => {
                console.log('Opening settings');
                setShowSettings(true);
              }}
              className="glass-panel p-2 hover:bg-white/10 transition-colors"
              title="Stream Settings"
            >
              <Tv className="w-4 h-4" />
            </button>
            <button 
              onClick={copyLink}
              className="glass-panel px-4 py-2 text-sm flex items-center gap-2 hover:bg-white/10 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              Invite Friend
            </button>
          </div>
        </header>

        {/* Video Player Area */}
        <div className="relative flex-1 rounded-2xl overflow-hidden video-container group">
          {/* Settings Overlay */}
          <AnimatePresence>
            {showSettings && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
              >
                <div className="glass-panel p-6 w-full max-w-md space-y-4">
                  <h3 className="text-lg font-bold">Stream Settings</h3>
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Video Stream URL</label>
                    <input 
                      type="text" 
                      value={streamUrl}
                      onChange={(e) => {
                        setStreamUrl(e.target.value);
                        socketRef.current?.send(JSON.stringify({
                          type: 'sync',
                          url: e.target.value,
                          playing: isPlaying,
                          time: videoRef.current?.currentTime || 0
                        }));
                      }}
                      placeholder="Paste M3U8 or MP4 link..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <p className="text-[10px] text-zinc-500">Tip: Paste a direct .mp4 or .m3u8 link to sync with friends.</p>
                  </div>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="w-full bg-orange-500 py-2 rounded-lg font-bold text-sm"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Video Player */}
          {isSharingScreen ? (
            <div className="w-full h-full bg-black flex items-center justify-center relative">
              <video 
                ref={remoteVideoRef}
                autoPlay 
                playsInline
                className="w-full h-full object-contain"
                srcObject={remoteStream || localStreamRef.current}
              />
              <div className="absolute top-4 left-4 glass-panel px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-orange-500 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                {localStreamRef.current ? 'Sharing Your Screen' : 'Watching Shared Screen'}
              </div>
            </div>
          ) : isWebsite ? (
            <div className="w-full h-full bg-zinc-900 flex flex-col items-center justify-center p-8 text-center space-y-6">
              <div className="p-6 bg-white/5 rounded-2xl border border-white/10 max-w-md">
                <Tv className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Protected Stream Detected</h2>
                <p className="text-sm text-zinc-400 mb-6">
                  Hotstar and other premium sites block direct embedding. To watch together, open the link in a new tab and use the chat to sync!
                </p>
                <div className="flex flex-col gap-3">
                  <a 
                    href={streamUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={() => console.log('Opening external link:', streamUrl)}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Share2 className="w-4 h-4" />
                    Open Hotstar Match
                  </a>
                  <button 
                    disabled={!isConnected}
                    onClick={() => {
                      const msg = {
                        id: Math.random().toString(36).substring(7),
                        user: 'SYSTEM',
                        text: `📢 ${username} is ready! Everyone, hit PLAY now!`,
                        timestamp: Date.now()
                      };
                      socketRef.current?.send(JSON.stringify({ type: 'chat', message: msg }));
                    }}
                    className={`w-full font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 ${
                      isConnected 
                        ? 'bg-white/10 hover:bg-white/20 text-white' 
                        : 'bg-white/5 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    {isConnected ? 'Send Sync Signal' : 'Connecting to Stadium...'}
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest">
                Sync Hub Active • Room: {roomId}
              </div>
            </div>
          ) : (
            <video 
              ref={videoRef}
              key={streamUrl} // Re-mount video when URL changes
              className="w-full h-full object-cover"
              src={streamUrl}
              autoPlay={joined}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              onSeeked={handleSeek}
            />
          )}
          
          {/* Custom Controls Overlay */}
          <div 
            onClick={() => setShowMobileControls(!showMobileControls)}
            className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity flex flex-col justify-end p-6 ${
              showMobileControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <div className="space-y-4">
              {/* Progress Bar Placeholder */}
              <div className="h-1 w-full bg-white/20 rounded-full overflow-hidden cursor-pointer">
                <div 
                  className="h-full bg-orange-500" 
                  style={{ width: `${(currentTime / (videoRef.current?.duration || 1)) * 100}%` }}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <button onClick={handlePlayPause} className="hover:text-orange-500 transition-colors">
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5" />
                    <div className="w-20 h-1 bg-white/20 rounded-full">
                      <div className="w-1/2 h-full bg-white rounded-full" />
                    </div>
                  </div>
                </div>
                <button className="hover:text-orange-500 transition-colors">
                  <Maximize2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Sync Indicator */}
          <div className="absolute top-4 right-4 glass-panel px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-orange-500 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
            Synced Playback
          </div>
        </div>

        {/* Scoreboard / Stats Placeholder */}
        <div className="glass-panel p-4 flex items-center justify-around">
          <div className="text-center">
            <div className="text-2xl font-black">IND</div>
            <div className="text-xs text-zinc-500">184/3 (32.4)</div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-center">
            <div className="text-xs text-orange-500 font-bold mb-1">TARGET: 285</div>
            <div className="text-sm font-mono">IND needs 101 runs in 104 balls</div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-center">
            <div className="text-2xl font-black">NZ</div>
            <div className="text-xs text-zinc-500">284/8 (50.0)</div>
          </div>
        </div>
      </div>

      {/* Sidebar - Chat */}
      <aside className="w-full lg:w-96 glass-panel m-4 lg:ml-0 flex flex-col overflow-hidden">
        <div className="p-4 border-bottom border-white/10 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold">Stadium Chat</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div 
                key={msg.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex flex-col ${msg.user === username ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-zinc-500 mb-1 px-1">{msg.user}</span>
                <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] ${
                  msg.user === 'SYSTEM'
                    ? 'bg-orange-500/20 text-orange-500 border border-orange-500/30 w-full text-center rounded-lg'
                    : msg.user === username 
                      ? 'bg-orange-500 text-white rounded-tr-none' 
                      : 'bg-white/10 text-zinc-200 rounded-tl-none'
                } ${msg.text.length < 3 ? 'text-4xl py-1 px-2 bg-transparent border-none' : ''}`}>
                  {msg.text}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Quick Reactions */}
        <div className="px-4 py-2 border-t border-white/5 flex justify-between bg-black/10">
          {['🏏', '🔥', '6️⃣', '4️⃣', '☝️', '😱'].map(emoji => (
            <button 
              key={emoji}
              onClick={() => {
                const newMessage: ChatMessage = {
                  id: Math.random().toString(36).substring(7),
                  user: username,
                  text: emoji,
                  timestamp: Date.now()
                };
                socketRef.current?.send(JSON.stringify({ type: 'chat', message: newMessage }));
              }}
              className="hover:scale-125 transition-transform p-1 grayscale hover:grayscale-0"
            >
              {emoji}
            </button>
          ))}
        </div>

        <form onSubmit={sendMessage} className="p-4 bg-black/20 border-t border-white/10 flex gap-2">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Say something..."
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-orange-500 transition-colors"
          />
          <button 
            type="submit"
            className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center hover:bg-orange-600 transition-colors active:scale-90"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </aside>
    </div>
  );
}
