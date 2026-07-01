import { Request } from 'express';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

export interface JwtPayload {
  userId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type QcStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'HOLD';
export type ShipmentStatus = 'DRAFT' | 'PICKING' | 'PACKED' | 'SHIPPED';
export type ProductionOrderStatus = 'CREATED' | 'MATERIAL_REQUESTED' | 'IN_PROGRESS' | 'COMPLETED' | 'QC_PENDING';
export type ProductType = 'RAW_MATERIAL' | 'FINISHED_GOOD' | 'PACKAGING';
export type TransactionType = 'RECEIVE' | 'MOVE' | 'PICK' | 'CONSUME' | 'ADJUST' | 'SHIP' | 'QC_HOLD' | 'QC_RELEASE';
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'LOGIN';
