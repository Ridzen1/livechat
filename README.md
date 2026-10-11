# Livechat

Relais Discord vers l’overlay via WebSocket. Dans `#livechat`, les liens et les images ou vidéos jointes sont transmis automatiquement. **Le texte seul nécessite le préfixe `!livechat`**, par exemple `!livechat Bonjour !`.

## Installation

1. Installer Node.js 22.12 ou ultérieur, puis lancer `npm ci`.
2. Copier `.env.example` vers `.env` et renseigner `DISCORD_TOKEN`.
3. Dans le portail développeur Discord, activer **Message Content Intent** pour le bot. Le bot doit avoir accès au canal avec la permission **Voir le salon**.
4. Lancer `npm start`.

Sur un hébergeur, définir les mêmes variables dans la configuration du service. Utiliser `npm ci` comme commande d’installation et `npm start` comme commande de démarrage.

| Variable | Comportement |
| --- | --- |
| `DISCORD_TOKEN` | Obligatoire. Jeton du bot, à ne pas publier. |
| `PORT` | Port HTTP/WebSocket, `8080` par défaut. |
| `LIVECHAT_CHANNEL_ID` | Facultatif. Identifiant exact du canal à écouter, prioritaire sur son nom. |

Sans identifiant configuré, le bot écoute les canaux nommés exactement `livechat` sur tous les serveurs auxquels il a accès. Pour cibler un seul canal, activer le mode développeur Discord, copier son identifiant et définir `LIVECHAT_CHANNEL_ID`. Le canal pourra alors être renommé sans interrompre le relais.

## Messages relayés

- Texte seul : affichage du texte et de l’auteur uniquement avec `!livechat`, retiré avant l’affichage. Les conversations sans préfixe sont ignorées.
- Image ou vidéo jointe : premier média éligible, accompagné du texte.
- Lien HTTP(S) : premier lien du message, même au milieu du texte, entre chevrons ou dans un lien Markdown. Le texte restant sert de légende.
- Commande `!livechat` : obligatoire pour le texte seul, facultative pour les médias ; le préfixe est retiré.

Les messages des bots et des webhooks, les messages privés et ceux des autres canaux sont ignorés. Les fils ne sont pas inclus automatiquement via leur canal parent. Aucun accusé d’envoi n’est posté dans Discord. Les modifications de messages et l’historique ne sont pas rejoués. Les messages sans texte ni média éligible (par exemple un sticker seul ou un PDF seul) sont ignorés.

Le protocole reste `{ type: 'play_media', url, text, author, avatar }`, avec `url: null` pour le texte seul. La lecture d’un lien dépend des formats et services pris en charge par l’overlay ; une page web quelconque n’est pas nécessairement un média lisible. Un seul média est transmis par message. Le relais ne stocke pas les messages : aucun rattrapage n’est effectué si l’overlay était déconnecté.

Le serveur WebSocket conserve son accès sans authentification pour être compatible avec l’overlay existant : toute personne disposant de son adresse peut recevoir le flux. Utiliser un canal destiné à cette diffusion.

## Vérifications

`npm test` exécute les tests de filtrage, parsing, configuration, relais WebSocket local, déconnexion, limites de taille et état HTTP. `npm audit --omit=dev` contrôle les dépendances installées.

Le point HTTP répond `200` lorsque Discord est prêt et `503` pendant une déconnexion. Les connexions WebSocket inactives sont vérifiées par ping/pong ; les connexions mortes ou engorgées sont fermées. Les erreurs de démarrage ferment le serveur et terminent le processus avec un code d’échec.

Pour valider après déploiement : ouvrir l’overlay, poster dans le canal configuré `!livechat Bonjour !`, un lien vidéo et une image jointe sans préfixe, puis vérifier qu’un texte sans préfixe et un message dans un autre canal ne sont pas transmis. Les tests automatisés n’utilisent aucun compte Discord et ne remplacent pas cette vérification.
