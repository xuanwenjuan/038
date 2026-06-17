import React, { useState, useCallback, useEffect } from 'react';
import { Annotation, RoomMember, ModelParams } from '../types';
import {
  fetchAnnotations,
  createAnnotation,
  deleteAnnotation,
  createShareLink,
} from '../collaboration/annotationApi';

interface Props {
  roomId: string | null;
  connected: boolean;
  currentUser: string;
  userColor: string;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  members: RoomMember[];
  onGotoAnnotation: (annotation: Annotation) => void;
  currentParams: ModelParams;
}

export const AnnotationPanel: React.FC<Props> = ({
  roomId,
  connected,
  currentUser,
  userColor,
  annotations,
  setAnnotations,
  members,
  onGotoAnnotation,
  currentParams,
}) => {
  const [newAnnotationText, setNewAnnotationText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const anns = await fetchAnnotations(roomId);
      setAnnotations(anns);
    })();
  }, [roomId, setAnnotations]);

  const handleAddAnnotation = useCallback(async () => {
    if (!roomId || !selectedPosition || !newAnnotationText.trim()) return;

    const ann = await createAnnotation({
      roomId,
      author: currentUser,
      authorColor: userColor,
      text: newAnnotationText.trim(),
      position: selectedPosition,
      params: currentParams,
    });

    if (ann) {
      setAnnotations(prev => [ann, ...prev]);
      setNewAnnotationText('');
      setSelectedPosition(null);
      setIsAdding(false);
    }
  }, [roomId, selectedPosition, newAnnotationText, currentUser, userColor, currentParams, setAnnotations]);

  const handleDelete = useCallback(async (annId: string) => {
    if (await deleteAnnotation(annId)) {
      setAnnotations(prev => prev.filter(a => a.id !== annId));
    }
  }, [setAnnotations]);

  const handleShare = useCallback(async (ann: Annotation) => {
    const share = await createShareLink({
      annotationId: ann.id,
      roomId: ann.roomId,
      params: ann.params,
    });
    if (share) {
      navigator.clipboard.writeText(share.url);
      alert(`短链接已复制到剪贴板:\n${share.url}`);
    } else {
      alert('分享链接生成失败');
    }
  }, []);

  const handleStartAdding = useCallback(() => {
    setIsAdding(true);
    alert('请在 3D 场景中点击位置以放置标注');
  }, []);

  if (!roomId) {
    return (
      <div className="annotation-panel">
        <div className="empty-annotation-hint">
          加入协同房间后可使用标注功能
        </div>
      </div>
    );
  }

  return (
    <div className="annotation-panel">
      <div className="annotation-header">
        <h3>📌 书签标注</h3>
        <div className="annotation-actions">
          <button
            className="members-toggle"
            onClick={() => setShowMembers(s => !s)}
            title="在线成员"
          >
            👥 {members.length}
          </button>
          <button
            className={`add-annotation-btn ${isAdding ? 'adding' : ''}`}
            onClick={isAdding ? () => { setIsAdding(false); setSelectedPosition(null); } : handleStartAdding}
          >
            {isAdding ? '取消' : '+ 添加标注'}
          </button>
        </div>
      </div>

      {showMembers && (
        <div className="members-list">
          <div className="members-title">在线成员</div>
          {members.length === 0 ? (
            <div className="members-empty">暂无其他成员</div>
          ) : (
            members.map(m => (
              <div key={m.sid} className="member-item">
                <span className="member-color" style={{ background: m.color }} />
                <span className="member-name">{m.name}</span>
              </div>
            ))
          )}
        </div>
      )}

      {isAdding && selectedPosition && (
        <div className="annotation-input">
          <div className="position-display">
            位置: ({selectedPosition.x.toFixed(1)}, {selectedPosition.y.toFixed(1)}, {selectedPosition.z.toFixed(1)})
          </div>
          <input
            type="text"
            placeholder="输入标注文字..."
            value={newAnnotationText}
            onChange={e => setNewAnnotationText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddAnnotation()}
            autoFocus
          />
          <button onClick={handleAddAnnotation} disabled={!newAnnotationText.trim()}>
            保存
          </button>
        </div>
      )}

      {isAdding && !selectedPosition && (
        <div className="annotation-hint">
          👆 点击 3D 场景任意位置放置标注
        </div>
      )}

      <div className="annotations-list">
        {annotations.length === 0 ? (
          <div className="empty-hint">暂无标注，点击"+ 添加标注"开始</div>
        ) : (
          annotations.map(ann => (
            <div key={ann.id} className="annotation-item">
              <div className="annotation-main">
                <div className="annotation-author" style={{ color: ann.authorColor }}>
                  {ann.author}
                </div>
                <div className="annotation-text">{ann.text}</div>
                <div className="annotation-meta">
                  {new Date(ann.timestamp * 1000).toLocaleString()}
                </div>
              </div>
              <div className="annotation-item-actions">
                <button
                  className="ann-action-btn goto-btn"
                  onClick={() => onGotoAnnotation(ann)}
                  title="跳转到此处"
                >
                  🎯
                </button>
                <button
                  className="ann-action-btn share-btn"
                  onClick={() => handleShare(ann)}
                  title="分享"
                >
                  🔗
                </button>
                {ann.author === currentUser && (
                  <button
                    className="ann-action-btn delete-btn"
                    onClick={() => handleDelete(ann.id)}
                    title="删除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
