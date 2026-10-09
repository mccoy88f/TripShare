import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tripshare/api/router';

type Outputs = inferRouterOutputs<AppRouter>;
export type TripDetail = Outputs['trips']['get'];
export type TripMemberT = TripDetail['members'][number];
export type ExpenseT = Outputs['expenses']['list'][number];
export type SettlementT = Outputs['settlements']['list'][number];
