import { AppError } from './errors.js';

const API_VERSION = '2026-03-10';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64Utf8(value) {
  const binary = atob(String(value).replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decoder.decode(bytes);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export class GitHubClient {
  constructor(env) {
    this.owner = env.GITHUB_OWNER;
    this.repo = env.GITHUB_REPO;
    this.token = env.GITHUB_TOKEN;
    this.branch = env.GITHUB_DATA_BRANCH || 'data';
    this.baseBranch = env.GITHUB_BASE_BRANCH || 'main';

    if (!this.owner || !this.repo || !this.token) {
      throw new AppError(
        500,
        'GITHUB_NOT_CONFIGURED',
        'Falta configurar GITHUB_OWNER, GITHUB_REPO o GITHUB_TOKEN en Cloudflare.',
      );
    }
  }

  async request(path, { method = 'GET', body, allow404 = false } = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'consejo-bordadoras-yucatan-app',
        'X-GitHub-Api-Version': API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (allow404 && response.status === 404) return null;

    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }

    if (!response.ok) {
      const message = payload?.message || `GitHub respondió con el estado ${response.status}.`;
      const code = response.status === 401 || response.status === 403
        ? 'GITHUB_AUTH_ERROR'
        : response.status === 404
          ? 'GITHUB_NOT_FOUND'
          : response.status === 409 || response.status === 422
            ? 'GITHUB_CONFLICT'
            : 'GITHUB_API_ERROR';
      throw new AppError(
        response.status === 404 ? 404 : response.status >= 500 ? 502 : 500,
        code,
        `No fue posible acceder a los datos en GitHub: ${message}`,
        { status: response.status },
      );
    }

    return payload;
  }

  repoPath(suffix = '') {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  async getRef(branch = this.branch, allow404 = false) {
    return this.request(
      this.repoPath(`/git/ref/heads/${encodeURIComponent(branch)}`),
      { allow404 },
    );
  }

  async ensureDataBranch() {
    const existing = await this.getRef(this.branch, true);
    if (existing) return existing;

    const baseRef = await this.getRef(this.baseBranch, false);
    try {
      return await this.request(this.repoPath('/git/refs'), {
        method: 'POST',
        body: {
          ref: `refs/heads/${this.branch}`,
          sha: baseRef.object.sha,
        },
      });
    } catch (error) {
      // Si dos solicitudes intentaron crear la rama al mismo tiempo, vuelve a leerla.
      if (error.code === 'GITHUB_CONFLICT') {
        const created = await this.getRef(this.branch, true);
        if (created) return created;
      }
      throw error;
    }
  }

  async getHeadSha() {
    const reference = await this.getRef(this.branch, true);
    return reference?.object?.sha || null;
  }

  async getCommit(sha) {
    return this.request(this.repoPath(`/git/commits/${encodeURIComponent(sha)}`));
  }

  async readFile(path, ref = this.branch) {
    const payload = await this.request(
      this.repoPath(`/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`),
      { allow404: true },
    );
    if (!payload) return null;
    if (Array.isArray(payload) || payload.type !== 'file') {
      throw new AppError(500, 'INVALID_GITHUB_FILE', `La ruta ${path} no corresponde a un archivo.`);
    }
    if (payload.encoding !== 'base64') {
      throw new AppError(500, 'INVALID_GITHUB_ENCODING', `GitHub devolvió un formato no compatible para ${path}.`);
    }
    return decodeBase64Utf8(payload.content);
  }

  async createCommitFromFiles({ files, message, expectedHead }) {
    const headSha = expectedHead || await this.getHeadSha();
    if (!headSha) {
      throw new AppError(500, 'DATA_BRANCH_MISSING', `No existe la rama de datos ${this.branch}.`);
    }

    const currentRef = await this.getRef(this.branch);
    if (expectedHead && currentRef.object.sha !== expectedHead) {
      throw new AppError(409, 'WRITE_CONFLICT', 'Los datos cambiaron mientras se procesaba la solicitud.');
    }

    const baseCommit = await this.getCommit(headSha);
    const treeEntries = Object.entries(files).map(([path, content]) => ({
      path,
      mode: '100644',
      type: 'blob',
      content: String(content),
    }));

    const tree = await this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: {
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      },
    });

    const commit = await this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: {
        message,
        tree: tree.sha,
        parents: [headSha],
      },
    });

    try {
      await this.request(this.repoPath(`/git/refs/heads/${encodeURIComponent(this.branch)}`), {
        method: 'PATCH',
        body: { sha: commit.sha, force: false },
      });
    } catch (error) {
      if (error.code === 'GITHUB_CONFLICT') {
        throw new AppError(409, 'WRITE_CONFLICT', 'Otra persona actualizó los datos al mismo tiempo.');
      }
      throw error;
    }

    return commit.sha;
  }
}
