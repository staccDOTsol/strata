use crate::{error::ErrorCode, state::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct InitializeFungibleEntanglerV0Args {
  pub authority: Pubkey,
  pub seed: Vec<any>,
  pub go_live_unix_time: i64,
  pub child_go_live_unix_time: i64,
  pub freeze_swap_unix_time: Option<i64>,
  pub freeze_child_unix_time: Option<i64>,
}

#[derive(Accounts)]
#[instruction(args: InitializeFungibleEntanglerV0Args)]
pub struct InitializeFungibleEntanglerV0<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(
    init,
    payer = payer,
    space = 512,
    seeds = [b"entangler", &args.seed],
    bump
  )]
  pub entangler: Box<Account<'info, FungibleEntanglerV0>>,
  #[account(
    init, 
    payer = payer,
    space = 512,
    seeds = [b"entangler", entangler.key().as_ref(), child_mint.key().as_ref()],
    bump,
  )]
  pub child_entangler: Box<Account<'info, FungibleChildEntanglerV0>>,  
  #[account(
    init,
    payer = payer,
    space = 512,
    seeds = [b"storage", entangler.key().as_ref()]
    bump,
    token::mint = target_mint,
    token::authority = entangler,
  )]
  pub storage: Box<Account<'info, TokenAccount>>,  
  #[account(
    init,
    payer = payer,
    space = 512,
    seeds = [b"storage", child_entangler.key().as_ref()]
    bump,
    token::mint = child_mint,
    token::authority = entangler,
  )]
  pub child_storage: Box<Account<'info, TokenAccount>>,    
  #[account(
    constraint = mint.is_initialized,
    constraint = mint.key() !== child_mint.key()
  )]
  pub mint: Box<Account<'info, Mint>>,    
  #[account(
    constraint = child_mint.is_initialized,
    constraint = child_mint.key() !== mint.key()
  )]
  pub child_mint: Box<Account<'info, Mint>>,
    
  pub token_program: Program<'info, Token>,
  pub system_program: Program<'info, System>,
  pub rent: Sysvar<'info, Rent>,
  pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
  ctx: Context<InitializeFungibleEntanglerV0>,
  args: InitializeFungibleEntanglerV0Args,
) -> Result<()> {
  let entangler = &mut ctx.accounts.entangler;
  let child_entangler = &mut ctx.accounts.child_entangler;

  entangler.authority = ctx.accounts.authority;
  entangler.mint = ctx.accounts.mint.key();
  entangler.storage = ctx.accounts.storage.key();
  entangler.go_live_unix_time = if args.go_live_unix_time < ctx.accounts.clock.unix_timestamp {
    ctx.accounts.clock.unix_timestamp
  } else {
    args.go_live_unix_time
  };
  entangler.freeze_swap_unix_time = args.freeze_swap_unix_time;
  entangler.created_at_unix_time = ctx.accounts.clock.unix_timestamp;
  entangler.bump_seed = *ctx.bumps.get("entangler").unwrap();
  entangler.storage_bump_seed = *ctx.bumps.get("storage").unwrap();

  child_entangler.authority = ctx.accounts.authority;
  child_entangler.parent_entangler = ctx.accounts.entangler.key();
  child_entangler.mint = ctx.accounts.child_mint.key();
  child_entangler.storage = ctx.accounts.child_storage.key();
  child_entangler.go_live_unix_time = if args.child_go_live_unix_time < ctx.accounts.clock.unix_timestamp {
    ctx.accounts.clock.unix_timestamp
  } else {
    args.child_go_live_unix_time
  };
  child_entangler.freeze_swap_unix_time = args.freeze_child_unix_time;
  child_entangler.created_at_unix_time = ctx.accounts.clock.unix_timestamp;
  child_entangler.bump_seed = *ctx.bumps.get("child_entangler").unwrap();
  child_entangler.storage_bump_seed = *ctx.bumps.get("child_storage").unwrap();

  Ok(())
}