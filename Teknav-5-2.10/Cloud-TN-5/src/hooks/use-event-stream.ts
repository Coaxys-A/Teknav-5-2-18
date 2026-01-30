'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useEventStream Hook
 * M11 - Queue Platform: "Realtime Queue Events + SSE"
 *
 * Provides:
 * - SSE connection to backend
 * - Automatic reconnection
 * - Event listener callback
 * - Connection status tracking
 */

type EventStreamOptions = {
  channel?: string;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
};

type EventListener = (event: any) => void;

export function useEventStream(
  channel: string,
  onEvent: EventListener,
  options: EventStreamOptions = {},
) {
  const {
    autoConnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [eventCount, setEventCount] = useState(0);

  // Cleanup function
  const cleanup = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.removeEventListener('message', handleMessage);
      eventSourceRef.current.removeEventListener('error', handleError);
      eventSourceRef.current.removeEventListener('open', handleOpen);
      eventSourceRef.current.removeEventListener('close', handleClose);
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
    reconnectAttemptsRef.current = 0;
  };

  // Message handler
  const handleMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
      setLastEvent(data);
      setEventCount(prev => prev + 1);
      setError(null);
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  };

  // Error handler
  const handleError = (event: Event) => {
    console.error('SSE connection error:', event);
    setError('Connection error');

    // Attempt reconnect
    if (reconnectAttemptsRef.current < maxReconnectAttempts) {
      reconnectAttemptsRef.current++;
      scheduleReconnect();
    } else {
      cleanup();
    }
  };

  // Open handler
  const handleOpen = (event: Event) => {
    console.log('SSE connection opened');
    setConnected(true);
    setConnecting(false);
    setError(null);
    reconnectAttemptsRef.current = 0;
  };

  // Close handler
  const handleClose = (event: Event) => {
    console.log('SSE connection closed');
    setConnected(false);
    setConnecting(false);

    // Attempt reconnect if not intentionally closed
    if (reconnectAttemptsRef.current < maxReconnectAttempts) {
      reconnectAttemptsRef.current++;
      scheduleReconnect();
    } else {
      cleanup();
    }
  };

  // Schedule reconnect
  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      console.log(`Attempting reconnect (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
      connect();
    }, reconnectInterval);
  };

  // Connect to SSE
  const connect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      setConnecting(true);
      setError(null);

      // Build SSE URL
      const url = new URL(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/events/stream`);
      url.searchParams.set('channel', channel);

      // Create EventSource
      const eventSource = new EventSource(url.toString());

      // Set up event listeners
      eventSource.addEventListener('message', handleMessage);
      eventSource.addEventListener('error', handleError);
      eventSource.addEventListener('open', handleOpen);
      eventSource.addEventListener('close', handleClose);

      eventSourceRef.current = eventSource;
    } catch (err) {
      console.error('Failed to create EventSource:', err);
      setError('Failed to connect');
      setConnecting(false);
      setConnected(false);
    }
  };

  // Disconnect from SSE
  const disconnect = () => {
    cleanup();
  };

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      cleanup();
    };
  }, [channel, autoConnect]);

  // Reconnect manually (exposed for UI)
  const reconnect = () => {
    cleanup();
    setTimeout(connect, 0);
  };

  return {
    connected,
    connecting,
    error,
    lastEvent,
    eventCount,
    connect,
    disconnect,
    reconnect,
  };
}
