import { Annotation, ModelParams } from '../types';

const API_BASE = 'http://localhost:8000';

export async function fetchAnnotations(roomId: string): Promise<Annotation[]> {
  try {
    const resp = await fetch(`${API_BASE}/api/annotations/${roomId}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.annotations || [];
  } catch (e) {
    return [];
  }
}

export async function createAnnotation(params: {
  roomId: string;
  author: string;
  authorColor: string;
  text: string;
  position: { x: number; y: number; z: number };
  params: ModelParams;
}): Promise<Annotation | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

export async function deleteAnnotation(annotationId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/api/annotations/${annotationId}`, {
      method: 'DELETE',
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

export async function createShareLink(data: {
  params?: ModelParams;
  viewpoint?: any;
  annotationId?: string;
  roomId?: string;
}): Promise<{ shortId: string; url: string } | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

export async function getShareLink(shortId: string): Promise<any | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/share/${shortId}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

export async function createRoom(): Promise<{ roomId: string; createdAt?: string } | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/rooms`, {
      method: 'POST',
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

export async function getRoom(roomId: string): Promise<any | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/rooms/${roomId}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}
