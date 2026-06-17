import { io, Socket } from 'socket.io-client';
import { ModelParams, RoomMember, Annotation } from '../types';

export interface CollaborationEvents {
  onParamsUpdated: (params: ModelParams, fromSid: string) => void;
  onMemberJoined: (member: RoomMember) => void;
  onMemberLeft: (sid: string) => void;
  onRoomMembers: (members: RoomMember[]) => void;
  onCursorMoved: (sid: string, position: { x: number; y: number; z: number }) => void;
  onAnnotationAdded: (annotation: Annotation) => void;
  onAnnotationDeleted: (annotationId: string) => void;
  onDisconnect: () => void;
  onConnect: () => void;
}

export class CollaborationService {
  private socket: Socket | null = null;
  private roomId: string | null = null;
  private userName: string = '';
  private userColor: string = '#5ab0ff';
  private connected = false;
  private eventHandlers: Partial<CollaborationEvents> = {};
  private apiBase: string;

  constructor(apiBase: string = 'http://localhost:8000') {
    this.apiBase = apiBase;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getRoomId(): string | null {
    return this.roomId;
  }

  getUserName(): string {
    return this.userName;
  }

  getUserColor(): string {
    return this.userColor;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  on<E extends keyof CollaborationEvents>(event: E, handler: CollaborationEvents[E]): void {
    this.eventHandlers[event] = handler as any;
  }

  off(event: keyof CollaborationEvents): void {
    delete this.eventHandlers[event];
  }

  async connect(
    roomId: string | null,
    userName: string,
    userColor: string = '#5ab0ff'
  ): Promise<{
    success: boolean;
    roomId: string;
    params: ModelParams;
    members: RoomMember[];
  }> {
    this.userName = userName;
    this.userColor = userColor;

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.apiBase, {
          transports: ['websocket', 'polling'],
          path: '/ws/socket.io',
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });

        this.socket.on('connect', () => {
          console.log('[WS] Connected');
          this.connected = true;
          this.eventHandlers.onConnect?.();

          const targetRoomId = roomId || this.generateRoomId();
          this.roomId = targetRoomId;

          this.socket!.emit(
            'join_room',
            {
              roomId: targetRoomId,
              userName: this.userName,
              color: this.userColor,
            },
            (response: any) => {
              if (response?.success) {
                resolve({
                  success: true,
                  roomId: response.roomId,
                  params: response.params,
                  members: response.members,
                });
              } else {
                reject(new Error(response?.error || '加入房间失败'));
              }
            }
          );
        });

        this.socket.on('disconnect', () => {
          console.log('[WS] Disconnected');
          this.connected = false;
          this.eventHandlers.onDisconnect?.();
        });

        this.socket.on('params_updated', (data: any) => {
          this.eventHandlers.onParamsUpdated?.(data.params, data.sid);
        });

        this.socket.on('member_joined', (data: any) => {
          this.eventHandlers.onMemberJoined?.(data.member);
        });

        this.socket.on('member_left', (data: any) => {
          this.eventHandlers.onMemberLeft?.(data.sid);
        });

        this.socket.on('room_members', (members: RoomMember[]) => {
          this.eventHandlers.onRoomMembers?.(members);
        });

        this.socket.on('cursor_moved', (data: any) => {
          this.eventHandlers.onCursorMoved?.(data.sid, data.position);
        });

        this.socket.on('annotation_added', (data: any) => {
          this.eventHandlers.onAnnotationAdded?.(data);
        });

        this.socket.on('annotation_deleted', (data: any) => {
          this.eventHandlers.onAnnotationDeleted?.(data.id);
        });

        this.socket.on('connect_error', (err: any) => {
          console.warn('[WS] Connect error, 使用本地模式');
          this.connected = false;
          resolve({
            success: false,
            roomId: roomId || 'local',
            params: {
              windShear: 0.008,
              buoyFreq: 0.02,
              coriolis: 1e-4,
            },
            members: [],
          });
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      if (this.roomId) {
        this.socket.emit('leave_room', { roomId: this.roomId });
      }
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.roomId = null;
  }

  sendParams(params: ModelParams): void {
    if (!this.connected && this.socket && this.roomId) {
      this.socket.emit('update_params', {
        roomId: this.roomId,
        params,
      });
    }
  }

  sendCursor(position: { x: number; y: number; z: number }): void {
    if (!this.connected && this.socket && this.roomId) {
      this.socket.emit('cursor_move', {
        roomId: this.roomId,
        position,
      });
    }
  }

  sendAnnotation(annotation: Annotation): void {
    if (!this.connected && this.socket && this.roomId) {
      this.socket.emit('add_annotation', annotation);
    }
  }

  sendDeleteAnnotation(annotationId: string): void {
    if (!this.connected && this.socket && this.roomId) {
      this.socket.emit('delete_annotation', {
        roomId: this.roomId,
        id: annotationId,
      });
    }
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 10).toLowerCase();
  }
}
