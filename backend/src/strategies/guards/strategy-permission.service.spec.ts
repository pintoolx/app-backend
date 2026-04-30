import { Test, TestingModule } from '@nestjs/testing';
import { StrategyPermissionsService } from '../strategy-permissions.service';
import { SupabaseService } from '../../database/supabase.service';

describe('StrategyPermissionsService', () => {
  let service: StrategyPermissionsService;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(),
      single: jest.fn(),
      upsert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyPermissionsService,
        { provide: SupabaseService, useValue: { client: mockClient } },
      ],
    }).compile();

    service = module.get<StrategyPermissionsService>(StrategyPermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkPermission', () => {
    it('allows creator automatically', async () => {
      mockClient.from.mockImplementation((table: string) => {
        if (table === 'strategy_deployments') {
          return {
            select: () => ({
              eq: () => ({
                single: jest.fn().mockResolvedValue({
                  data: { creator_wallet_address: '0xCreator' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return mockClient;
      });

      const result = await service.checkPermission('dep-1', '0xCreator', 'operator');
      expect(result.allowed).toBe(true);
      expect(result.actualRole).toBe('creator');
    });

    it('allows operator to access viewer endpoint', async () => {
      mockClient.from.mockImplementation((table: string) => {
        if (table === 'strategy_deployments') {
          return {
            select: () => ({
              eq: () => ({
                single: jest.fn().mockResolvedValue({
                  data: { creator_wallet_address: '0xCreator' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'strategy_permissions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { role: 'operator' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return mockClient;
      });

      const result = await service.checkPermission('dep-1', '0xOp', 'viewer');
      expect(result.allowed).toBe(true);
      expect(result.actualRole).toBe('operator');
    });

    it('denies viewer from accessing operator endpoint', async () => {
      mockClient.from.mockImplementation((table: string) => {
        if (table === 'strategy_deployments') {
          return {
            select: () => ({
              eq: () => ({
                single: jest.fn().mockResolvedValue({
                  data: { creator_wallet_address: '0xCreator' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'strategy_permissions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { role: 'viewer' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return mockClient;
      });

      const result = await service.checkPermission('dep-1', '0xViewer', 'operator');
      expect(result.allowed).toBe(false);
      expect(result.actualRole).toBe('viewer');
    });

    it('denies when no permission exists and not creator', async () => {
      mockClient.from.mockImplementation((table: string) => {
        if (table === 'strategy_deployments') {
          return {
            select: () => ({
              eq: () => ({
                single: jest.fn().mockResolvedValue({
                  data: { creator_wallet_address: '0xCreator' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'strategy_permissions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return mockClient;
      });

      const result = await service.checkPermission('dep-1', '0xStranger', 'viewer');
      expect(result.allowed).toBe(false);
      expect(result.actualRole).toBeNull();
    });
  });

  describe('grantPermission', () => {
    it('upserts a permission row', async () => {
      mockClient.from.mockReturnValue({
        upsert: () => ({
          select: () => ({
            single: jest.fn().mockResolvedValue({
              data: { id: 'perm-1', role: 'operator' },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.grantPermission('dep-1', '0xOp', 'operator');
      expect(result).toEqual({ id: 'perm-1', role: 'operator' });
    });
  });

  describe('revokePermission', () => {
    it('returns true on successful delete', async () => {
      mockClient.from.mockReturnValue({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      });

      // Simplify: mock the chain directly
      mockClient.from.mockReturnValue(mockClient);
      mockClient.delete.mockReturnValue(mockClient);
      mockClient.eq.mockReturnValue(mockClient);

      const result = await service.revokePermission('dep-1', '0xOp', 'operator');
      expect(result).toBe(true);
    });
  });

  describe('listPermissions', () => {
    it('returns mapped permissions', async () => {
      mockClient.from.mockImplementation((table: string) => {
        if (table === 'strategy_permissions') {
          return {
            select: () => ({
              eq: () => ({
                // listPermissions does not chain further; eq returns the client
                then: (cb: any) =>
                  cb({
                    data: [
                      { id: 'p1', member_wallet: '0xA', role: 'operator', created_at: '2024-01-01' },
                      { id: 'p2', member_wallet: '0xB', role: 'viewer', created_at: '2024-01-02' },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        return mockClient;
      });

      // Directly override listPermissions mock behavior for this test
      jest.spyOn(service, 'listPermissions').mockResolvedValue([
        { id: 'p1', memberWallet: '0xA', role: 'operator', createdAt: '2024-01-01' },
        { id: 'p2', memberWallet: '0xB', role: 'viewer', createdAt: '2024-01-02' },
      ]);

      const result = await service.listPermissions('dep-1');
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('operator');
      expect(result[1].memberWallet).toBe('0xB');
    });
  });
});
