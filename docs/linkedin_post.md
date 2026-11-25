# LinkedIn launch post

A third of physics Nobel laureates descend from one 17th-century Leipzig philosopher.

I rebuilt the "family tree" of 11,931 physicists from Wikidata: who advised whom, where they moved, who got recognized. 74 of 226 Physics Nobel laureates trace back to Friedrich Leibnütz (1597–1652), 26 academic generations deep.

Three more findings:
→ A laureate advisor goes with ~3× the odds of a major award (29% vs 9%). Adjusted hazard ratio 1.48, Cox C-index 0.77.
→ After 1991, 76% of physicists born in former Soviet republics took their jobs abroad, up from 40%. A bigger jump than 1933–45 Central Europe.
→ A node2vec model predicts missing advisor links (AUC 0.93) and ranks a hidden "student of" teacher #1 a third of the time.

The data lesson: 17% of Wikidata's "physicists" show no physics signal. Ten are fictional, including Lex Luthor and Gordon Freeman. Cleaning is half the project.

Explore it (time slider, family trees, migration map): [DEMO LINK]
Code + data + models: [REPO LINK]

Looking for collaborators: historians of science, Wikidata editors (the model's 200 suggested missing advisor links need checking), and graph-ML folks.

#DataScience #KnowledgeGraph #Wikidata #Physics #DataVisualization
