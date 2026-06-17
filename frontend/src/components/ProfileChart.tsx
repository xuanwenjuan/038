import React, { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { ProfileData } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Props {
  profileData: ProfileData | null;
  onClose: () => void;
}

export const ProfileChart: React.FC<Props> = ({ profileData, onClose }) => {
  if (!profileData) return null;

  const vertical = profileData.vertical;
  const labels = vertical.map(v => `${v.z.toFixed(0)} m`).reverse();

  const data = {
    labels,
    datasets: [
      {
        label: '风速 (m/s)',
        data: vertical.map(v => v.speed).reverse(),
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: 'U 分量',
        data: vertical.map(v => v.u).reverse(),
        borderColor: '#4ecdc4',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        borderDash: [],
      },
      {
        label: 'V 分量',
        data: vertical.map(v => v.v).reverse(),
        borderColor: '#ffe66d',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        borderDash: [5, 5],
      },
      {
        label: 'W 分量',
        data: vertical.map(v => v.w * 50).reverse(),
        borderColor: '#a29bfe',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        borderDash: [2, 2],
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 500,
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#b0c8e0',
          font: { size: 11 },
          padding: 10,
        },
      },
      title: {
        display: true,
        text: `垂直剖面 · P1(${profileData.point1.x.toFixed(0)},${profileData.point1.y.toFixed(0)}) → P2(${profileData.point2.x.toFixed(0)},${profileData.point2.y.toFixed(0)})`,
        color: '#8fd0ff',
        font: { size: 12, weight: 600 as const },
        padding: { bottom: 10 },
      },
      tooltip: {
        backgroundColor: 'rgba(10, 14, 26, 0.95)',
        titleColor: '#8fd0ff',
        bodyColor: '#e0e8f0',
        borderColor: 'rgba(100, 150, 200, 0.3)',
        borderWidth: 1,
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(100, 150, 200, 0.1)',
        },
        ticks: {
          color: '#7890a8',
          font: { size: 10 },
        },
        title: {
          display: true,
          text: '风速 (m/s) · W 分量已放大 50 倍',
          color: '#7890a8',
          font: { size: 10 },
        },
      },
      y: {
        grid: {
          color: 'rgba(100, 150, 200, 0.1)',
        },
        ticks: {
          color: '#7890a8',
          font: { size: 10 },
        },
        title: {
          display: true,
          text: '高度 (m)',
          color: '#7890a8',
          font: { size: 10 },
        },
      },
    },
  };

  return (
    <div className="profile-chart-overlay">
      <div className="profile-chart-panel">
        <div className="profile-chart-header">
          <h3>垂直剖面分析</h3>
          <button className="profile-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="profile-chart-body">
          <Line data={data} options={options} />
        </div>
        <div className="profile-chart-footer">
          <span className="profile-meta">
            采样点数: {profileData.num_samples} · 层数: {profileData.nlev} · 
            计算耗时: {profileData.compute_time_ms.toFixed(0)} ms
          </span>
        </div>
      </div>
    </div>
  );
};
