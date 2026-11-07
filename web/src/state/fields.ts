// Edits to the article's fields. A user edit is an `override`; the extracted value stays underneath,
// so "reset" can bring it back and the alternatives list keeps its options.
import type { ArticleModel, Field } from '../core/types.ts';
import type { AppState } from './app-state.ts';

export type FieldName = keyof ArticleModel['fields'];

export function withField<K extends FieldName>(
  state: AppState,
  name: K,
  change: (field: ArticleModel['fields'][K]) => ArticleModel['fields'][K],
): AppState {
  const article = state.article;
  if (!article) return state;
  return {
    ...state,
    article: { ...article, fields: { ...article.fields, [name]: change(article.fields[name]) } },
  };
}

export const setOverride = <K extends FieldName>(
  state: AppState,
  name: K,
  value: unknown,
): AppState =>
  withField(state, name, (field) => ({ ...field, override: value }) as ArticleModel['fields'][K]);

export const clearOverride = <K extends FieldName>(state: AppState, name: K): AppState =>
  withField(state, name, (field) => {
    const { override: _gone, ...rest } = field as Field<unknown>;
    return rest as ArticleModel['fields'][K];
  });

export const hasOverride = (state: AppState, name: FieldName): boolean =>
  state.article?.fields[name].override !== undefined;
