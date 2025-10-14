// Supabase-only backend exports
import * as impl from './db_supabase.js';

export const db = impl.db;
export const initDb = impl.initDb;
export const touchSession = impl.touchSession;
export const listContent = impl.listContent;
export const createContent = impl.createContent;
export const deleteContent = impl.deleteContent;
export const updateContent = impl.updateContent;
export const getNextContent = impl.getNextContent;
export const recordRating = impl.recordRating;
export const getStats = impl.getStats;
export const getContentById = impl.getContentById;
export const recomputeScore = impl.recomputeScore;
export const getSummaryCounts = impl.getSummaryCounts;
export const recordBatch = impl.recordBatch;
export const findUserByUsername = impl.findUserByUsername;
export const countContent = impl.countContent;


