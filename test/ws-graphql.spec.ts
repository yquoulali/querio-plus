import { describe, it, expect } from 'vitest';
import { parseWsFrame, isGraphQLWebSocketUrl, isGraphQLWsFrame } from '../src/capture/ws-graphql';

describe('parseWsFrame', () => {
  describe('graphql-ws protocol', () => {
    it('parses connection_init message', () => {
      const msg = parseWsFrame(JSON.stringify({ type: 'connection_init', payload: {} }));
      expect(msg?.kind).toBe('connection');
      expect(msg).toMatchObject({ kind: 'connection', messageType: 'connection_init' });
    });

    it('parses connection_ack message', () => {
      const msg = parseWsFrame(JSON.stringify({ type: 'connection_ack' }));
      expect(msg?.kind).toBe('connection');
    });

    it('parses subscribe message', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'subscribe',
        payload: {
          query: 'subscription OnMessage { messageAdded { id content } }',
          operationName: 'OnMessage',
          variables: { roomId: '123' },
        },
      }));
      expect(msg?.kind).toBe('subscription-start');
      if (msg?.kind === 'subscription-start') {
        expect(msg.protocol).toBe('graphql-ws');
        expect(msg.id).toBe('1');
        expect(msg.query).toContain('subscription');
        expect(msg.operationName).toBe('OnMessage');
        expect(msg.variables).toEqual({ roomId: '123' });
        expect(msg.operation?.type).toBe('subscription');
        expect(msg.operation?.name).toBe('OnMessage');
        expect(msg.operation?.rootFields).toEqual(['messageAdded']);
      }
    });

    it('parses next message (data)', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'next',
        payload: {
          data: { messageAdded: { id: '1', content: 'Hello' } },
        },
      }));
      expect(msg?.kind).toBe('subscription-data');
      if (msg?.kind === 'subscription-data') {
        expect(msg.protocol).toBe('graphql-ws');
        expect(msg.id).toBe('1');
        expect(msg.data).toEqual({ messageAdded: { id: '1', content: 'Hello' } });
        expect(msg.hasErrors).toBe(false);
      }
    });

    it('parses next message with errors', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'next',
        payload: {
          data: null,
          errors: [{ message: 'Something went wrong' }],
        },
      }));
      expect(msg?.kind).toBe('subscription-data');
      if (msg?.kind === 'subscription-data') {
        expect(msg.hasErrors).toBe(true);
        expect(msg.errors).toHaveLength(1);
      }
    });

    it('parses error message (array of errors)', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'error',
        payload: [{ message: 'Unauthorized' }],
      }));
      expect(msg?.kind).toBe('subscription-error');
      if (msg?.kind === 'subscription-error') {
        expect(msg.id).toBe('1');
        expect(msg.errors).toHaveLength(1);
        expect(msg.errors[0].message).toBe('Unauthorized');
      }
    });

    it('parses complete message', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'complete',
      }));
      expect(msg?.kind).toBe('subscription-complete');
      if (msg?.kind === 'subscription-complete') {
        expect(msg.id).toBe('1');
      }
    });

    it('parses ping/pong as connection messages', () => {
      expect(parseWsFrame(JSON.stringify({ type: 'ping' }))?.kind).toBe('connection');
      expect(parseWsFrame(JSON.stringify({ type: 'pong' }))?.kind).toBe('connection');
    });
  });

  describe('subscriptions-transport-ws (legacy) protocol', () => {
    it('parses start message', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'start',
        payload: {
          query: 'subscription { newPost { title } }',
        },
      }));
      expect(msg?.kind).toBe('subscription-start');
      if (msg?.kind === 'subscription-start') {
        expect(msg.protocol).toBe('subscriptions-transport-ws');
        expect(msg.id).toBe('1');
        expect(msg.operation?.type).toBe('subscription');
      }
    });

    it('parses data message', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'data',
        payload: {
          data: { newPost: { title: 'Hello World' } },
        },
      }));
      expect(msg?.kind).toBe('subscription-data');
      if (msg?.kind === 'subscription-data') {
        expect(msg.protocol).toBe('subscriptions-transport-ws');
        expect(msg.data).toEqual({ newPost: { title: 'Hello World' } });
      }
    });

    it('parses connection_keep_alive', () => {
      const msg = parseWsFrame(JSON.stringify({ type: 'connection_keep_alive' }));
      expect(msg?.kind).toBe('connection');
    });

    it('parses stop message as unknown (no id handling needed)', () => {
      const msg = parseWsFrame(JSON.stringify({ type: 'stop', id: '1' }));
      // 'stop' is not in our handled types, so it's unknown
      expect(msg?.kind).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for empty payload', () => {
      expect(parseWsFrame('')).toBeUndefined();
      expect(parseWsFrame('   ')).toBeUndefined();
    });

    it('returns unknown for invalid JSON', () => {
      const msg = parseWsFrame('not json');
      expect(msg?.kind).toBe('unknown');
    });

    it('returns unknown for JSON without type field', () => {
      const msg = parseWsFrame(JSON.stringify({ id: '1', data: 'test' }));
      expect(msg?.kind).toBe('unknown');
    });

    it('returns unknown for subscribe without query', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'subscribe',
        payload: { variables: {} },
      }));
      expect(msg?.kind).toBe('unknown');
    });

    it('returns unknown for message without id (except connection messages)', () => {
      const msg = parseWsFrame(JSON.stringify({
        type: 'next',
        payload: { data: {} },
      }));
      expect(msg?.kind).toBe('unknown');
    });

    it('handles anonymous subscription (no operationName)', () => {
      const msg = parseWsFrame(JSON.stringify({
        id: '1',
        type: 'subscribe',
        payload: {
          query: 'subscription { tick }',
        },
      }));
      expect(msg?.kind).toBe('subscription-start');
      if (msg?.kind === 'subscription-start') {
        expect(msg.operationName).toBeUndefined();
        // Name should fall back to first root field
        expect(msg.operation?.name).toBeUndefined();
        expect(msg.operation?.rootFields).toEqual(['tick']);
      }
    });
  });
});

describe('isGraphQLWebSocketUrl', () => {
  it('returns true for common GraphQL WS URLs', () => {
    expect(isGraphQLWebSocketUrl('wss://api.example.com/graphql')).toBe(true);
    expect(isGraphQLWebSocketUrl('ws://localhost:4000/graphql')).toBe(true);
    expect(isGraphQLWebSocketUrl('wss://example.com/subscriptions')).toBe(true);
    expect(isGraphQLWebSocketUrl('wss://graphql.example.com/ws')).toBe(true);
    expect(isGraphQLWebSocketUrl('wss://api.example.com/gql')).toBe(true);
  });

  it('returns false for non-WebSocket URLs', () => {
    expect(isGraphQLWebSocketUrl('https://api.example.com/graphql')).toBe(false);
    expect(isGraphQLWebSocketUrl('http://localhost/graphql')).toBe(false);
  });

  it('returns false for non-GraphQL WebSocket URLs', () => {
    expect(isGraphQLWebSocketUrl('wss://api.example.com/chat')).toBe(false);
    expect(isGraphQLWebSocketUrl('ws://localhost:8080/socket')).toBe(false);
  });
});

describe('isGraphQLWsFrame', () => {
  it('returns true for GraphQL protocol messages', () => {
    expect(isGraphQLWsFrame(JSON.stringify({ type: 'connection_init' }))).toBe(true);
    expect(isGraphQLWsFrame(JSON.stringify({
      id: '1',
      type: 'subscribe',
      payload: { query: 'subscription { tick }' },
    }))).toBe(true);
    expect(isGraphQLWsFrame(JSON.stringify({
      id: '1',
      type: 'next',
      payload: { data: {} },
    }))).toBe(true);
  });

  it('returns false for non-GraphQL messages', () => {
    expect(isGraphQLWsFrame('not json')).toBe(false);
    expect(isGraphQLWsFrame(JSON.stringify({ action: 'ping' }))).toBe(false);
    expect(isGraphQLWsFrame(JSON.stringify({ type: 'custom_event' }))).toBe(false);
  });
});
