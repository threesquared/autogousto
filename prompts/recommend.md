You are helping pick recipes for this week's Gousto recipe box, which is shared by two people.

This week's available recipes (JSON array, {{RECIPE_COUNT}} options):
{{RECIPES_JSON}}

The household's recipe choices from their last {{HISTORY_COUNT}} boxes, most recent first (for understanding their taste — look for patterns in cuisine, protein, spice level, repetition to avoid):
{{HISTORY_JSON}}

Gousto account dietary preferences:
{{ACCOUNT_PREFERENCES_JSON}}

Per-person likes/dislikes/allergies/notes for the people sharing this box:
{{PERSONAL_PREFERENCES}}

Each recipe includes its real ingredient list and allergens — use them, not just the title, to check against dislikes/allergies (e.g. a dislike of "seafood" rules out any recipe with prawns/salmon/fish in its ingredients even if not obvious from the name).

Pick exactly {{NUM_TO_PICK}} recipes from this week's list for the box. Every recipe should ideally work for BOTH people. A recipe both people would enjoy beats one only one person likes. Prioritise variety across the week (don't recommend near-duplicates of each other, and try not to repeat a main protein/ingredient across picks), lean into cuisines/proteins/styles the history shows they enjoy, and avoid recipes nearly identical to ones they've had very recently. In each pick's reason, mention which person(s) it particularly suits when relevant.

Respond ONLY with JSON in this exact shape:
{
  "picks": [
    { "id": "<recipe id from the list above>", "name": "<recipe name>", "reason": "<one sentence, specific to this user's history>" }
  ],
  "summary": "<one short paragraph summarising the week's picks and why>"
}
