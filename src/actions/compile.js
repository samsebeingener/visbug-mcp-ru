/**
 * actions/compile.js — changes[] → write-recipes (store v5).
 */

import {
  compileWriteRecipes,
  formatWriteRecipesBuffer,
  formatWriteRecipesJsonBlock,
} from './write-recipe.js'

/**
 * @param {object[]} changes
 * @returns {object[]}
 */
export function compileChangesToActions(changes) {
  return compileWriteRecipes(changes)
}

/**
 * @param {object[]} changes
 * @returns {string}
 */
export function formatActionsJsonBlock(changes) {
  return formatWriteRecipesJsonBlock(changes)
}

export {
  compileWriteRecipes,
  formatWriteRecipesBuffer,
  formatWriteRecipesJsonBlock,
}
