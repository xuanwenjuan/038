import React, { useState, useCallback } from 'react';
import { RoomMember, ModelParams } from '../types';
import { createRoom, createShareLink } from '../collaboration/annotationApi';

interface Props {
  roomId: string | null;
  connected: boolean;
  userName: string;
  userColor: string;
  members: RoomMember[];
  onJoinRoom: (roomId: string | null, userName: string, color: string) => void;
  onLeaveRoom: () => void;
  onToggleProfileMode: () => void;
  profileMode: boolean;
  onToggleAnnotationMode: () => void;
  annotationMode: boolean;
  currentParams: ModelParams;
}

const USER_COLORS = [
  '#5ab0ff', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe',
  '#fd79a8', '#00b894', '#e17055', '#74b9ff', '#fdcb6e',
];

export const CollaborationPanel: React.FC<Props> = ({
  roomId,
  connected,
  userName,
  userColor,
  members,
  onJoinRoom,
  onLeaveRoom,
  onToggleProfileMode,
  profileMode,
  onToggleAnnotationMode,
  annotationMode,
  currentParams,
}) => {
  const [inputUserName, setInputUserName] = useState(userName || `用户_${Math.random().toString(36).slice(2, 6)}`);
  const [inputRoomId, setInputRoomId] = useState('');
  const [selectedColor, setSelectedColor] = useState(userColor || USER_COLORS[0]);
  const [showInvite, setShowInvite] = useState(false);

  const handleJoin = useCallback(async () => {
    if (!inputUserName.trim()) return;
    const room = inputRoomId.trim() || null;
    onJoinRoom(room, inputUserName.trim(), selectedColor);
  }, [inputUserName, inputRoomId, selectedColor, onJoinRoom]);

  const handleCreateRoom = useCallback(async () => {
    if (!inputUserName.trim()) return;
    const newRoom = await createRoom();
    if (newRoom) {
      onJoinRoom(newRoom.roomId, inputUserName.trim(), selectedColor);
    }
  }, [inputUserName, selectedColor, onJoinRoom]);

  const handleShareRoom = useCallback(async () => {
    const share = await createShareLink({
      roomId: roomId ?? undefined,
      params: currentParams,
    });
    if (share) {
      navigator.clipboard.writeText(share.url);
      alert(`房间邀请链接已复制到剪贴板:\n${share.url}`);
    }
  }, [roomId, currentParams]);

  if (!roomId) {
    return (
      <div className="collaboration-panel">
        <h3>👥 协同参数调优室</h3>
        <p className="collab-hint">
          加入或创建房间以与其他研究人员实时协作
        </p>

        <div className="form-group">
          <label>您的昵称</label>
          <input
            type="text"
            value={inputUserName}
            onChange={e => setInputUserName(e.target.value)}
            placeholder="输入您的昵称"
          />
        </div>

        <div className="form-group">
          <label>选择颜色</label>
          <div className="color-picker">
            {USER_COLORS.map(c => (
              <button
                key={c}
                className={`color-swatch ${selectedColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setSelectedColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>房间 ID (可选，留空创建新房间)</label>
          <input
            type="text"
            value={inputRoomId}
            onChange={e => setInputRoomId(e.target.value)}
            placeholder="输入房间 ID 或留空"
          />
        </div>

        <div className="collab-actions">
          <button className="collab-btn primary" onClick={handleJoin}>
            {inputRoomId.trim() ? '加入房间' : '创建并加入'}
          </button>
          <button className="collab-btn secondary" onClick={handleCreateRoom}>
            新建房间
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="collaboration-panel connected">
      <div className="room-header">
        <div>
          <h3>👥 协同调优室</h3>
          <div className="room-id">
            房间: <span className="room-id-value">{roomId}</span>
          </div>
        </div>
        <div className="room-badges">
          <span className={`conn-badge ${connected ? 'connected' : 'offline'}`}>
            {connected ? '已连接' : '本地模式'}
          </span>
          <button className="invite-btn" onClick={handleShareRoom} title="分享房间">
            🔗
          </button>
          <button className="leave-btn" onClick={onLeaveRoom} title="离开房间">
            ✕
          </button>
        </div>
      </div>

      <div className="collab-members">
        <div className="members-label">在线成员 ({members.length})</div>
        <div className="members-inline">
          {members.map(m => (
            <div key={m.sid} className="member-chip" title={m.name}>
              <span className="member-dot" style={{ background: m.color }} />
              <span>{m.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="collab-tools">
        <button
          className={`tool-btn ${annotationMode ? 'active' : ''}`}
          onClick={onToggleAnnotationMode}
        >
          📌 {annotationMode ? '取消标注' : '添加标注'}
        </button>
        <button
          className={`tool-btn ${profileMode ? 'active' : ''}`}
          onClick={onToggleProfileMode}
        >
          📊 {profileMode ? '取消剖面' : '提取剖面'}
        </button>
      </div>

      <div className="collab-hint-text">
        {annotationMode && '📌 标注模式：点击 3D 场景添加书签标注'}
        {profileMode && '📊 剖面模式：依次点击两点提取垂直剖面'}
        {!annotationMode && !profileMode && '💡 拖动滑块可将参数同步给房间内所有人'}
      </div>

      {showInvite && (
        <div className="invite-dialog">
          <input
            type="text"
            readOnly
            value={`http://localhost:5173/room/${roomId}`}
          />
          <button onClick={() => {
            navigator.clipboard.writeText(`http://localhost:5173/room/${roomId}`);
            setShowInvite(false);
          }}>复制链接</button>
        </div>
      )}
    </div>
  );
};
