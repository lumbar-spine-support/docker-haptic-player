import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { HttpError } from '../utils/errorHandler';

const PAGE_PATTERN = /^[a-z0-9-]+$/;
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

export function createDocsRouter(docsDir: string): Router {
    const router = Router();
    const root = path.resolve(docsDir);

    router.use('/assets', (req, res, next) => {
        if (!ASSET_EXTENSIONS.has(path.extname(req.path).toLowerCase())) {
            next(new HttpError(404, 'Asset not found'));
            return;
        }
        next();
    }, express.static(root, { dotfiles: 'deny', index: false, fallthrough: false }));

    router.get('/', (_req, res) => {
        let pages: string[] = [];
        try {
            pages = fs.readdirSync(root)
                .filter((name) => name.endsWith('.md'))
                .map((name) => name.slice(0, -3))
                .filter((name) => PAGE_PATTERN.test(name))
                .sort();
        } catch {
            // Missing docs directory just means no pages.
        }
        res.json({ pages });
    });

    router.get('/:page', (req, res) => {
        const page = req.params.page;
        if (!PAGE_PATTERN.test(page)) throw new HttpError(404, 'Page not found');
        const filePath = path.join(root, `${page}.md`);
        if (!fs.existsSync(filePath)) throw new HttpError(404, 'Page not found');
        res.type('text/markdown; charset=utf-8');
        res.send(fs.readFileSync(filePath, 'utf-8'));
    });

    return router;
}
