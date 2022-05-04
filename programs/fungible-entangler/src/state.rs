use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct FungibleEntanglerV0 {
  pub authority: Option<Pubkey>,
  pub mint: Pubkey,
  pub storage: Pubkey,
  pub go_live_unix_time: i64,
  pub freeze_swap_unix_time: Option<i64>,
  pub created_at_unix_time: i64,

  pub bump_seed: u8,
  pub storage_bump_seed: u8,
}

#[account]
#[derive(Default)]
pub struct FungibleChildEntanglerV0 {
  pub authority: Option<Pubkey>,
  pub parent_entangler: Pubkey,
  pub mint: Pubkey,
  pub storage: Pubkey,
  pub go_live_unix_time: i64,
  pub freeze_swap_unix_time: Option<i64>,
  pub created_at_unix_time: i64,
  
  pub bump_seed: u8,
  pub storage_bump_seed: u8,
}