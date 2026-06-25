const ANIMALS = [
  "beaver",
  "bunny",
  "cat",
  "chick",
  "cow",
  "crab",
  "deer",
  "dog",
  "elephant",
  "fox",
  "giraffe",
  "hog",
  "koala",
  "lion",
  "monkey",
  "panda",
  "parrot",
  "penguin",
  "pig",
  "polar",
  "tiger",
];

/** Pick a random cube-pet animal id for a player's persistent avatar. */
export function randomAnimal(): string {
  return ANIMALS[Math.floor(Math.random() * ANIMALS.length)] ?? "fox";
}
