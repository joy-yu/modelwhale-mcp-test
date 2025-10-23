import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * 会话信息接口
 * 存储每个 MCP 会话的连接对象和时间戳
 */
interface SessionInfo {
  /** StreamableHTTP 传输实例 */
  transport: StreamableHTTPServerTransport;
  /** 会话创建时间（Unix 时间戳） */
  createdAt: number;
  /** 最后访问时间（Unix 时间戳，用于空闲检测） */
  lastAccessedAt: number;
}

/**
 * 会话管理器配置
 */
interface SessionManagerConfig {
  /** 最大会话数量，超过后会清理最旧的会话 */
  maxSessions?: number;
  /** 空闲超时时间（毫秒），超过此时间未访问的会话会被清理 */
  idleTimeout?: number;
  /** 清理任务执行间隔（毫秒） */
  cleanupInterval?: number;
}

/**
 * MCP StreamableHTTP 会话管理器
 *
 * 为什么不使用 express-session？
 * 1. MCP 使用自定义 header (mcp-session-id) 而非 Cookie
 * 2. 需要存储不可序列化的对象 (StreamableHTTPServerTransport)
 * 3. 需要自定义的空闲超时和清理逻辑
 */
export class SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  private readonly config: Required<SessionManagerConfig>;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      maxSessions: config.maxSessions ?? 100,
      idleTimeout: config.idleTimeout ?? 30 * 60 * 1000, // 30分钟
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5分钟
    };
  }

  /**
   * 启动定期清理任务
   *
   * 会根据配置的间隔时间，定期检查并清理过期会话
   * 如果已经启动，重复调用不会创建新的定时器
   */
  startCleanup(): void {
    if (this.cleanupTimer) {
      return; // 已经启动
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupInterval);

    console.log(`会话管理器已启动，定期清理间隔: ${this.config.cleanupInterval / 60000} 分钟`);
  }

  /**
   * 停止清理任务
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      console.log('会话管理器清理任务已停止');
    }
  }

  /**
   * 获取会话
   *
   * @param sessionId - 会话 ID
   * @returns 会话对应的 transport 实例，不存在则返回 undefined
   * @remarks 调用此方法会自动更新会话的最后访问时间，延长会话生命周期
   */
  get(sessionId: string): StreamableHTTPServerTransport | undefined {
    const sessionInfo = this.sessions.get(sessionId);
    if (sessionInfo) {
      // 更新最后访问时间
      sessionInfo.lastAccessedAt = Date.now();
      return sessionInfo.transport;
    }
    return undefined;
  }

  /**
   * 检查会话是否存在
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 添加新会话
   *
   * @param sessionId - 会话 ID
   * @param transport - StreamableHTTP 传输实例
   * @remarks
   * - 会自动检查会话数量限制，达到上限时会清理最旧的会话
   * - 会记录创建时间和最后访问时间
   */
  add(sessionId: string, transport: StreamableHTTPServerTransport): void {
    // 检查会话数量限制
    if (this.sessions.size >= this.config.maxSessions) {
      console.warn(`达到最大会话数限制 (${this.config.maxSessions})，清理最旧的会话`);
      this.cleanupOldestSession();
    }

    const now = Date.now();
    this.sessions.set(sessionId, {
      transport,
      createdAt: now,
      lastAccessedAt: now,
    });

    console.log(`会话已添加: ${sessionId}，当前会话数: ${this.sessions.size}`);
  }

  /**
   * 删除会话
   */
  delete(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`会话已删除: ${sessionId}，剩余会话数: ${this.sessions.size}`);
    }
    return deleted;
  }

  /**
   * 清理过期会话
   *
   * 遍历所有会话，删除空闲时间超过配置阈值的会话
   * 会主动调用 transport.close() 关闭连接
   *
   * @private
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, sessionInfo] of this.sessions.entries()) {
      const idleTime = now - sessionInfo.lastAccessedAt;
      if (idleTime > this.config.idleTimeout) {
        console.log(`清理空闲会话 ${sessionId}，空闲时间: ${Math.floor(idleTime / 1000)}秒`);
        try {
          sessionInfo.transport.close();
        } catch (error) {
          console.error(`关闭会话 ${sessionId} 时出错:`, error);
        }
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`已清理 ${cleanedCount} 个过期会话，剩余会话数: ${this.sessions.size}`);
    }
  }

  /**
   * 清理最旧的会话（当达到最大会话数时）
   *
   * 根据 lastAccessedAt 找到最久未访问的会话并清理
   * 用于防止会话数量超过配置的上限
   *
   * @private
   */
  private cleanupOldestSession(): void {
    let oldestSessionId: string | null = null;
    let oldestTime = Infinity;

    for (const [sessionId, sessionInfo] of this.sessions.entries()) {
      if (sessionInfo.lastAccessedAt < oldestTime) {
        oldestTime = sessionInfo.lastAccessedAt;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      const sessionInfo = this.sessions.get(oldestSessionId)!;
      console.log(`清理最旧的会话 ${oldestSessionId}`);
      try {
        sessionInfo.transport.close();
      } catch (error) {
        console.error(`关闭会话 ${oldestSessionId} 时出错:`, error);
      }
      this.sessions.delete(oldestSessionId);
    }
  }

  /**
   * 关闭所有会话
   *
   * 用于服务器关闭时清理所有活跃会话
   * 会依次关闭所有 transport 连接并停止清理任务
   */
  closeAll(): void {
    console.log(`正在关闭所有会话，总数: ${this.sessions.size}`);

    for (const [sessionId, sessionInfo] of this.sessions.entries()) {
      try {
        sessionInfo.transport.close();
      } catch (error) {
        console.error(`关闭会话 ${sessionId} 时出错:`, error);
      }
    }

    this.sessions.clear();
    this.stopCleanup();
  }

  /**
   * 获取会话统计信息
   *
   * @returns 包含活跃会话数、配置上限和每个会话详细信息的统计对象
   * @remarks 用于健康检查和监控
   */
  getStats(): {
    activeCount: number;
    maxSessions: number;
    sessions: Array<{
      sessionId: string;
      idleTime: number;
      age: number;
    }>;
  } {
    const now = Date.now();
    const sessions = Array.from(this.sessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      idleTime: Math.floor((now - info.lastAccessedAt) / 1000), // 秒
      age: Math.floor((now - info.createdAt) / 1000), // 秒
    }));

    return {
      activeCount: this.sessions.size,
      maxSessions: this.config.maxSessions,
      sessions,
    };
  }

  /**
   * 获取配置信息
   */
  getConfig() {
    return {
      maxSessions: this.config.maxSessions,
      idleTimeoutMinutes: this.config.idleTimeout / 60000,
      cleanupIntervalMinutes: this.config.cleanupInterval / 60000,
    };
  }
}
